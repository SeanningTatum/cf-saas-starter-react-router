---
name: prompt-eval
description: Run a prompt's golden set as a real eval suite and turn the result into a CI gate — deterministic graders first, a calibrated LLM judge only where nothing cheaper works, a committed baseline, and a pass/fail verdict with per-tag regressions, cost, and latency. Use when asked to "test this prompt", "run evals", "did my prompt change break anything", "add an eval CI gate", or invokes /prompt-eval.
user-invocable: true
---

# prompt-eval

Turn a golden set into a number you can gate on. The output is a verdict — pass or
fail against a committed baseline — plus the per-tag breakdown, cost, and latency
that tell you *why*.

Order is fixed: **grade cheapest-first → score → diff against baseline → gate.**
A judge model is the last rung of the ladder, not the first.

`$ARGUMENTS` names the prompt directory (e.g. `/prompt-eval invoice-extraction`)
and may carry `--baseline` to write a new baseline instead of comparing to one.

## When to use

- "Run the evals" / "test this prompt" / "did my change regress anything".
- "Set up an eval CI gate."
- Before merging any prompt version bump.
- Runs `/prompt-eval`.

Needs a scaffolded prompt directory — if there is no `golden.jsonl`, run
`/prompt-scaffold` first. For multi-step pipelines, eval each node with this skill
*and* the pipeline end-to-end (see `/prompt-pipeline`).

## Preflight (stop on any failure)

1. **Prompt directory exists** with `prompt.ts` (or equivalent) and
   `golden.jsonl`. No golden set → stop, run `/prompt-scaffold`.
2. **Runner present:** `npx promptfoo@latest --version`. Install as a
   devDependency if missing — never as a runtime dependency.
3. **Credentials:** the provider key is set, or `ant auth status` reports an
   active profile. If neither, tell the user to run `! ant auth login` and stop —
   you cannot do it for them.
4. **Golden set is big enough:** under 20 cases, or zero adversarial cases, the
   pass rate is noise. Say so, and offer to add cases before running.
5. **Baseline present?** If `evals/<name>.baseline.json` is missing, this run
   establishes it — say that explicitly rather than reporting a phantom "no
   regressions".

## The grader ladder

Grade every case at the cheapest rung that can answer it. Each rung down is
slower, costlier, and noisier than the one above.

| Rung | Grader | Answers |
| --- | --- | --- |
| 1 | Schema validation | Is the output even the right shape? |
| 2 | Field equality / `must_not` | Does it match the label? |
| 3 | Programmatic check | Do line items sum to the total; is the cited span actually in the source? |
| 4 | LLM judge (rubric) | Only genuinely subjective qualities — tone, helpfulness, faithfulness. |

If a case fails rung 1 or 2, do not escalate it to a judge. It already failed.

## Judge rules (rung 4)

A judge is a second model whose verdict you are trusting. Treat it as a
measurement instrument that itself needs calibrating.

- **Force a structured verdict.** The judge returns a schema
  (`{ pass: boolean, score: number, reason: string }`), enforced via
  `output_config.format` or a `strict: true` tool — never free prose you regex.
- **Pin the judge model separately** from the model under test, and record it in
  the run metadata. `claude-sonnet-5` is a good default; `claude-haiku-4-5` for
  high-volume cheap classification — but note Haiku 4.5 **takes no `effort`
  parameter**, so a Haiku judge omits it rather than setting `medium`.
- **Never let the model under test judge its own output.** Same-model grading
  measures self-consistency, not correctness.
- **The judge sees the output and the rubric — not the reasoning.** Feeding it the
  candidate's chain of thought biases it toward plausible-sounding wrong answers.
- **Calibrate the judge before trusting it.** Keep ~10 hand-scored cases
  (some deliberately bad) in `judge-calibration.jsonl`. The judge must agree with
  the human labels **≥ 90%** before its verdicts count. Re-run calibration
  whenever the judge model or rubric changes.
- **A judge that never fails anything is broken.** If the calibration set's
  known-bad cases pass, the rubric is too loose — fix it before reporting a green
  suite.

Rubrics are specific and checkable. Not *"is the summary good"* — instead *"every
claim in the summary appears in the source document; no numbers are introduced
that are not in the source; length is under 120 words"*.

## Workflow

### 1. Run the suite

```bash
npx promptfoo eval -c prompts/<name>/promptfooconfig.yaml -o evals/<name>.latest.json
```

Add `--no-cache` when you are deliberately re-measuring latency or want fresh
model calls; leave the cache on for iteration. Run the deterministic graders
through the repo's own test command as well (`bun test prompts/<name>`) so a
failing contract also fails the normal test job.

### 2. Score

Per case: pass/fail plus which rung failed. Aggregate:

- **overall pass rate**,
- **pass rate per tag** — `happy`, `edge`, `adversarial` reported separately;
  a suite that is green overall while `adversarial` slipped is not green,
- **cost** (input/output/cache tokens → dollars),
- **latency** p50 and p95,
- **cache hit rate** (`usage.cache_read_input_tokens` ÷ total prompt tokens).

### 3. Diff against the baseline

`evals/<name>.baseline.json` is committed. Compare the current run to it and
print a table of movements — pass rate per tag, cost, p95 — with newly failing
case ids named individually. A case that flipped from pass to fail is the
headline; a 1% aggregate move is not.

### 4. Gate

```
FAIL if  adversarial pass rate dropped at all         (hard gate — no tolerance)
FAIL if  overall pass rate dropped > 2 points
FAIL if  any case regressed from pass → fail
FAIL if  judge calibration agreement < 90%
WARN if  cost per case rose > 25%
WARN if  p95 latency rose > 50%
```

Adversarial regressions are a hard gate because they are security-relevant: a
prompt-injection case that starts passing the attacker's instruction is a
vulnerability, not a quality dip. Report warnings without failing, but report them
loudly.

### 5. Write the baseline (only when asked)

A baseline is only replaced deliberately — with `--baseline`, or after a version
bump the user has approved. Silently rewriting the baseline destroys the ability
to detect regressions, so **never** update it as a side effect of a failing run.
Record in it: prompt version, model id, effort, judge model, git sha, date, case
count by tag, and every metric above.

## CI wiring

Add a job that runs the suite on any change under `prompts/**` and fails on the
gate. Keep it separate from the unit-test job — it costs money and hits the
network, so it should be visibly distinct from a hermetic test run.

- Cache the provider responses between attempts on the same commit so a re-run
  after a flaky network failure does not re-bill the whole suite.
- Post the diff table as a PR comment; the reviewer's question is always "what
  moved", not "what is the absolute number".
- For a large golden set, use the **Batch API** — 50% cheaper, results come back
  in any order, so key by `custom_id`, never by position. (Not available on
  Bedrock or Vertex.)

## Cost control

- **Prompt caching is the biggest lever** — cache reads cost ~0.1× and writes
  ~1.25× (5-minute TTL), so a suite replaying one system prefix across 40 cases
  should be almost entirely cache reads. If `cache_read_input_tokens` is ~0,
  something in the prefix is drifting per case; find it before optimizing
  anything else.
- **A cache entry is only readable once the first response starts streaming.**
  Firing all N cases in parallel means all N pay full price. Send one case, await
  its first token, then fan out the remaining N−1.
- **Drop effort on rungs that do not need it.** Judges usually work fine at
  `medium`; the model under test must stay at whatever the prompt module pins.

## Final summary

Report: the verdict (PASS/FAIL) and which gate decided it; overall and per-tag
pass rates with the delta vs baseline; every newly-failing case id; judge
calibration agreement; cost and p95 latency with deltas; cache hit rate; and the
run metadata (prompt version, model, effort, judge model, git sha). If the run
established a first baseline, say so — do not describe it as "no regressions".

## Rules

- **Cheapest grader that can answer wins.** Never send a schema violation to a judge.
- **Never let the model under test grade itself.**
- **Judge verdicts are schema-locked**, and the judge is calibrated before it counts.
- **Adversarial regressions fail the build**, with no tolerance band.
- **Never silently rewrite the baseline** — it is the only thing making the number mean anything.
- **Never edit a golden label to make a test pass.** Fix the prompt, or change the label in its own PR with a reason.
- **Report cost and latency every run** — a quality gain that tripled p95 is a decision the user makes, not you.
- **Say when a suite is too small to conclude anything.**
