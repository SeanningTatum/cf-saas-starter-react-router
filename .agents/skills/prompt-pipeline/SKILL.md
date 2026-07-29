---
name: prompt-pipeline
description: Design a multi-step LLM pipeline with an explicit coordinator, cheap workers, and an independent checker — schema contracts on every edge, a capped repair loop, model tiering, and per-node evals. Picks the smallest thing that works (typed step functions before LangGraph) instead of reaching for a framework by default. Use when a task needs several model calls, a plan-then-execute shape, verification of another model's output, retries/branching, or invokes /prompt-pipeline.
user-invocable: true
---

# prompt-pipeline

Multi-step LLM work fails at the seams, not in the prompts. This skill builds the
seams: a schema on every edge, one component that plans, cheap components that do
the work, and an independent component whose only job is to try to reject the
result.

Order is fixed: **pick the smallest architecture → contract every edge → tier the
models → cap the repair loop → eval each node and the whole.**

`$ARGUMENTS` describes the pipeline (e.g. `/prompt-pipeline triage incoming
support tickets and draft replies`).

## When to use

- A task needs more than one model call, or a plan-then-execute shape.
- One model's output must be verified before it is used or shown.
- Branching, retries, or human-in-the-loop approval between steps.
- Runs `/prompt-pipeline`.

Each node in the pipeline is a prompt — scaffold it with `/prompt-scaffold` and
gate it with `/prompt-eval`. This skill wires them together.

## Step 1: pick the smallest architecture that works

Do not start from a framework. Start from the control flow:

| Shape | Build it as | Why not more |
| --- | --- | --- |
| One call, structured output | A single prompt module | A pipeline of one is a prompt |
| 2–4 fixed steps, no branching | Typed step functions, plain `await` | A graph library buys you nothing; the code *is* the diagram |
| Fan-out over N independent items | `Promise.all` over one worker prompt | Concurrency is not orchestration |
| Branching, retries, resumable state, human approval mid-run | **LangGraph** (`@langchain/langgraph`) | This is the part worth importing: `StateGraph` + typed state + checkpointing |
| Open-ended tool use, model decides the steps | Provider-native agent loop / tool runner | A hand-rolled `while (stop_reason === "tool_use")` loop is a solved problem |

State the choice and the reason in one line before writing code. "Four fixed
steps, no branching → typed step functions, no graph library" is a real design
decision and belongs in the PR description.

Reach for LangChain the library only when you actually want its abstractions
(retrievers, loaders, a provider-swap layer). Chains-for-the-sake-of-chains adds
a translation layer between you and the API for no gain, and it is the reason
most LLM pipelines are hard to debug.

## Step 2: the three roles

### Coordinator

Plans and routes. Never does the bulk work itself.

- High tier, high effort — `claude-opus-5` at `high`/`xhigh`. This is where
  judgment lives.
- Emits a **plan as a schema**: an ordered list of steps with the worker to call
  and the input for each. A coordinator returning prose is not a coordinator.
- Sees the task and the worker catalogue; does not see raw worker internals.
- Give it the *reason* for the task, not just the task — intent improves routing.

### Workers

Do one narrow thing each.

- Cheap tier — `claude-haiku-4-5` or `claude-sonnet-5`. Most worker tasks are
  extraction, classification, or a single transformation. **`claude-haiku-4-5`
  takes no `effort` parameter** — passing one errors, so a Haiku worker pins the
  model only. `effort` is available on Opus 5 and Sonnet 5.
- Each worker is its own scaffolded prompt with its own golden set and its own
  output schema. If a worker's schema is "a string", the boundary is wrong.
- Workers are independent: no worker reads another worker's reasoning. Pass data,
  never transcripts.

### Checker

Independently verifies the result against the contract, and is genuinely allowed
to say no.

- Mid tier — `claude-sonnet-5` is usually right. Pin it separately from the
  workers.
- **A different model instance from the one that produced the output.** Same-model
  self-review measures self-consistency, not correctness.
- **Sees the output and the contract only — never the producer's reasoning.**
  Chain of thought is persuasive; that is exactly the problem.
- Returns a structured verdict: `{ pass, violations: string[], severity }`.
  Never prose.
- **Prove the checker fires.** Put a known-bad case in its golden set. A checker
  with a 0% rejection rate in production is not validating anything — it is a
  rubber stamp, and you will not notice until it matters. Track and report its
  rejection rate.

## Step 3: contract every edge

Every boundary between steps is a schema, validated at runtime:

```ts
import { z } from "zod";

export const Plan = z.object({
  steps: z.array(z.object({
    worker: z.enum(["classify", "extract", "draft"]),
    input: z.record(z.string()),
  })).min(1).max(8),
});

export const Verdict = z.object({
  pass: z.boolean(),
  violations: z.array(z.string()),
  severity: z.enum(["none", "minor", "blocking"]),
});
```

Validate on the way out of every node, not just at the end. A pipeline that
discovers a malformed step-2 output during step 5 has already wasted the tokens
and buried the cause.

## Step 4: cap the repair loop

A checker rejection triggers a retry with the violations fed back — bounded:

```ts
const MAX_REPAIRS = 2;

for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
  const draft = await worker(input, attempt > 0 ? previousViolations : undefined);
  const verdict = Verdict.parse(await checker(draft, contract));
  if (verdict.pass) return draft;
  previousViolations = verdict.violations;          // record before any exit
  if (verdict.severity === "blocking" || attempt >= MAX_REPAIRS) break;
}
throw new PipelineError("checker rejected after repairs", { previousViolations });
```

- **Fail closed.** Exhausting the budget surfaces the failure with the violations
  attached — it never returns the last rejected draft as if it passed. Record the
  violations *before* any exit path, or the error you throw describes the previous
  attempt instead of the one that actually failed.
- **`blocking` exits immediately.** A blocking verdict on the first attempt means
  the prompt or the contract is wrong — feeding it back as if it were repairable
  just re-buys the same mistake. Only non-blocking violations are worth a retry.
- **Two repairs, not ten.** If two rounds of explicit feedback do not fix it, the
  prompt or the contract is wrong; more attempts just burn tokens on the same
  mistake.
- **Log every attempt.** A rising repair rate is the earliest signal that an
  upstream prompt has drifted.

## Step 5: LangGraph, when you actually need it

For branching, retries, resumable runs, or a human approval gate. `StateGraph` +
`Annotation` from `@langchain/langgraph` is the stable core; the prebuilt agent
helpers (`createReactAgent`) live in the toolkit package — **verify the import
path against the installed version** before writing it, since the prebuilt
surface has moved between releases.

```ts
import { Annotation, StateGraph } from "@langchain/langgraph";

const State = Annotation.Root({
  task: Annotation<string>,
  plan: Annotation<Plan | null>,
  draft: Annotation<string | null>,
  violations: Annotation<string[]>({
    reducer: (a, b) => b,          // replace, don't accumulate stale feedback
    default: () => [],
  }),
  repairs: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
});

const graph = new StateGraph(State)
  .addNode("coordinate", coordinate)
  .addNode("work", work)
  .addNode("check", check)
  // Budget exhausted with violations outstanding is a failure, not a result.
  .addNode("fail", (s) => {
    throw new PipelineError("checker rejected after repairs", {
      violations: s.violations,
    });
  })
  .addEdge("__start__", "coordinate")
  .addEdge("coordinate", "work")
  .addEdge("work", "check")
  .addConditionalEdges("check", (s) =>
    s.violations.length === 0 ? "__end__" : s.repairs >= 2 ? "fail" : "work")
  .compile();
```

Three things to get right: **reducers** (a `messages`-style append reducer on a
feedback field silently accumulates every past rejection into the next prompt);
the **loop bound** in the conditional edge — a graph with no repair ceiling is an
unbounded spend; and a **distinct failure terminal**. Routing an exhausted repair
budget to `__end__` is the subtle one: the graph resolves normally, so a caller
doing `await graph.invoke(input)` treats a rejected draft as a successful run and
the fail-closed guarantee is silently gone. Either throw from a `fail` node as
above, or carry an explicit `failed` flag in state that every caller checks — but
do not share a terminal with the success path.

## Edge and serverless runtimes

If this ships to Cloudflare Workers, Lambda, or Deno Deploy:

- **Enable `nodejs_compat`** for LangGraph on Workers, and check the bundle size
  before committing to it. For a 3-step linear pipeline, typed step functions
  avoid the question entirely.
- **Checkpointing needs real storage** — D1, KV, or a Durable Object on Workers.
  The in-memory saver does not survive an isolate, which is the whole point of
  checkpointing.
- **Long pipelines outlive a request.** A multi-minute coordinator run belongs in
  a queue or a durable workflow with the client polling, not in a request
  handler waiting on it. Coordinator turns at high effort can run for minutes.
- **Keep eval tooling out of the bundle** — promptfoo and any test harness are
  devDependencies.

## Step 6: eval the nodes and the whole

Two suites, both required:

1. **Per-node** — each worker, the coordinator, and the checker get their own
   golden set and their own `/prompt-eval` gate. Node-level failures are
   diagnosable; end-to-end failures are not.
2. **End-to-end** — a golden set of task → final output, run through the whole
   pipeline. This is what catches seam bugs: a coordinator that routes to the
   wrong worker, a schema mismatch, a checker that passes everything.

Report per-run: total cost, p95 latency, the **repair rate**, and the **checker
rejection rate**. Those last two are the pipeline's health metrics — a repair rate
climbing toward the cap, or a rejection rate at zero, both mean something broke
quietly.

## Final summary

Report: the architecture chosen and why (including what you deliberately did not
use); each node with its pinned model and effort; the schemas on each edge; the
repair cap and failure behavior; where state lives if the pipeline is resumable;
the per-node and end-to-end eval commands; and the cost and p95 latency of one
full run.

## Rules

- **Smallest architecture that works.** No graph library for a straight line.
- **The coordinator does not do the work**, and workers do not plan.
- **The checker is a different model instance and never sees the producer's reasoning.**
- **Prove the checker can fail** — known-bad case in its golden set, rejection rate reported.
- **Every edge is a validated schema.** No prose between nodes.
- **Repair loops are capped and fail closed** — never return a rejected draft as a pass.
- **Tier the models deliberately** — high effort where judgment lives, cheap tier for extraction.
- **Never pass one node's chain of thought to another.** Pass data.
- **Every node gets its own golden set**, plus an end-to-end suite for the seams.
