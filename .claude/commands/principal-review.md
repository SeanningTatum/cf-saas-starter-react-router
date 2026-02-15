---
description: Senior/principal engineer review verifying implementation matches plan and follows best practices
argument-hint: <feature name or file paths to review>
allowed-tools: Read, Glob, Grep, Bash
---

# Principal Review

Act as a senior/principal engineer to verify that the implementation matches the feature or plan and is implemented in the best way. This review requires deep reasoning for principal-engineer-level judgment.

Review target: $ARGUMENTS

## Model and Scope

- **Scope:** Compare implementation to the stated feature/plan; then assess architecture, patterns, and tradeoffs.
- **Output:** Structured report with alignment findings and implementation-quality findings, plus concrete recommendations.

## Inputs to Gather

1. **Plan or feature spec**
   - `docs/plans/*-implementation.md`, `docs/features/*-architecture.md`, or user-provided plan/spec.
   - If none, ask: "No plan/spec found. Point me to the feature doc or describe scope and acceptance criteria."
2. **Implementation**
   - Code that implements the feature: routes, repositories, tRPC, UI, workflows, schema.
   - Use `git diff main...HEAD --name-only` and relevant files, or user-specified paths.

## Phase 1: Plan / Feature Alignment

Verify the code delivers what the plan or feature specifies.

### Checklist

- **Scope:** Does the implementation cover all items in the plan (user stories, acceptance criteria, edge cases)?
- **Omissions:** Any planned behavior or acceptance criteria not implemented or only partially implemented?
- **Scope creep:** Any implemented behavior that is outside the plan and should be deferred or removed?
- **Data model:** Do schema and types match the plan's data model and relationships?
- **APIs / flows:** Do routes, tRPC procedures, and workflows match the described flows and contracts?
- **Error handling:** Are planned error cases and user-facing messages implemented as specified?
- **Security / access:** Are ownership, org scoping, and permission checks as specified in the plan?

### Output for Phase 1

- List each planned item or acceptance criterion and mark: **Met**, **Partial**, **Missing**, or **Out of scope**.
- Call out any gaps or extra scope with file/area references.

## Phase 2: Implementation Quality

Evaluate whether the implementation is done in the best way (architecture, patterns, maintainability, safety).

### Dimensions

| Dimension | What to check |
|-----------|----------------|
| **Architecture** | Layering (repo → tRPC → UI), no bypasses (e.g. DB in routes), clear boundaries, workflows for long-running work. |
| **Project patterns** | Repositories in `app/repositories/`, tRPC in `app/trpc/routes/`, Zod validation, loader auth and `context.trpc`, constants in `app/lib/constants/`, utils in `app/lib/utils.ts`. |
| **Correctness** | Edge cases, null/undefined, empty lists, idempotency where relevant, transaction boundaries. |
| **Security** | Auth on procedures and loaders, org/tenant scoping, no raw user input in queries, sensitive data not logged. |
| **Performance** | N+1 avoidance, unnecessary work in hot paths, appropriate indexing for new queries. |
| **Maintainability** | DRY (reuse existing schemas/components/helpers), naming, single responsibility, testability. |
| **Errors** | Custom errors from `@/models/errors` in repos, clear messages, no swallowed errors. |

### Output for Phase 2

- For each dimension: **OK**, **Improve**, or **Fix**.
- Brief rationale and, when relevant, file/line or area.
- Prioritized recommendations (must-fix vs nice-to-have).

## Report Template

Use this structure for the review output:

```markdown
# Principal Review: [Feature / Plan Name]

**Plan/spec:** [path or one-line description]
**Implementation:** [paths or "branch diff"]

---

## 1. Plan alignment

| Item / acceptance criterion | Status | Notes |
|----------------------------|--------|-------|
| … | Met / Partial / Missing / N/A | … |

**Gaps:** [List any missing or partial items.]
**Out of scope:** [List any implemented behavior not in plan.]

---

## 2. Implementation quality

| Dimension        | Status   | Notes |
|------------------|----------|-------|
| Architecture     | OK / Improve / Fix | … |
| Project patterns | OK / Improve / Fix | … |
| Correctness      | … | … |
| Security         | … | … |
| Performance     | … | … |
| Maintainability | … | … |
| Errors          | … | … |

---

## 3. Recommendations

**Must fix:** [List with file/area.]
**Should improve:** [List.]
**Nice to have:** [List.]

---

## 4. Verdict

- **Alignment:** [Meets plan / Partial / Does not meet plan] — [one sentence.]
- **Quality:** [Ready / Needs improvements / Needs fixes before merge.]
```

## Workflow Summary

1. **Gather:** Locate or request plan/spec; identify implementation files or diff.
2. **Phase 1:** Compare implementation to plan; fill alignment table and gaps/out-of-scope.
3. **Phase 2:** Score implementation quality by dimension; add notes and recommendations.
4. **Report:** Emit the report using the template; end with verdict and prioritized next steps.

## When to Use This Skill

- After implementing a feature from a plan: "Check this against the plan."
- Before or after PR: "Principal review of this feature."
- When verifying scope: "Does the code match the feature doc?"
- When asking for best-practices review: "Is this implemented the best way?"

For PR standards (rules, DRY, docs, testing, migrations), use /pr-checker instead or in addition.
