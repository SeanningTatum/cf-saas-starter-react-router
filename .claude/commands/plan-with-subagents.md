---
description: Creates structured implementation plans with task assignments and PR validation steps
argument-hint: <feature or task to plan>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Plan with Subagents

Create structured implementation plans that assign appropriate tasks to each step and include PR validation.

Planning request: $ARGUMENTS

## Before Planning: Rules Index

**IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning.**

Read `CLAUDE.md` and project documentation for the compressed Rules Index. When planning tasks that touch specific areas, note which rules apply:

| File Pattern | Rule to Include in Plan |
|--------------|------------------------|
| `app/repositories/*.ts` | Repository pattern (see CLAUDE.md) |
| `app/trpc/routes/*.ts` | Repository pattern (see CLAUDE.md) |
| `app/routes/**/*.tsx` | Routes conventions (see CLAUDE.md) |
| `app/db/schema.ts` | Database conventions (see CLAUDE.md) |
| `app/components/*-modal.tsx` | Modal patterns (see CLAUDE.md) |
| `**/stripe*`, `**/payment*` | Stripe conventions (see CLAUDE.md) |
| `e2e/**/*` | Playwright rules (see CLAUDE.md) |
| `docs/**/*.md` | Documentation conventions (see CLAUDE.md) |

Include rule requirements in task descriptions so each step knows what patterns to follow.

## When to Use

- User requests a plan for feature implementation
- Complex tasks requiring multiple files/layers
- Work that will result in a PR

## Planning Workflow

### Step 1: Analyze the Work Request

Identify:
1. **Type of work**: Feature, bug fix, or refactor
2. **Scope**: Files and layers affected
3. **Dependencies**: Order constraints between tasks

### Step 2: Break Down into Tasks

Create tasks following the data flow pattern:

```
1. Competitive Research (if new feature with UX decisions)
2. Schema/Database changes
3. Repository layer
4. tRPC routes
5. UI Components
6. Route pages
7. Feature Architecture Documentation (docs/features/)
8. Debug Logging (for complex logic/integrations)
9. Testing
10. Context Documentation
11. Architecture Documentation (high-level-architecture.md)
12. Analytics Dashboard (if new data to track)
13. Principal Review (plan alignment + implementation quality)
14. PR Validation
```

Skip layers not affected by the work.

### Step 3: Assign Task Types

Map each task to the appropriate approach:

| Task Type | Approach | When to Use |
|-----------|----------|-------------|
| Database exploration | Read and search codebase | Understanding schema, finding related code |
| Schema changes | Direct implementation | Adding tables, fields, migrations |
| Repository/tRPC | Direct implementation | Business logic implementation |
| UI Components | Direct implementation | Building React components |
| Styling from Figma | CSS variable conversion | Converting Figma designs |
| Design validation | Bash with playwright | Verifying UI matches designs |
| Add logging | Direct implementation | Adding debug logs to code |
| Testing | Bash with playwright + write tests | Verify implementation, write e2e tests |
| Documentation | Direct file editing | Update project docs |
| Architecture Docs | /architecture-tracker | Update route maps, flows, changelog |
| Analytics | Direct implementation | Create dashboards for new data |
| Principal Review | /principal-review | Plan alignment + implementation quality |
| PR Validation | /pr-checker | Final validation step |

### Step 4: Build the Plan

Output format:

```markdown
## Implementation Plan: {Feature Name}

### Overview
{Brief description of what will be implemented}

### Tasks

#### Task 1: {Task Name}
**Approach:** `{approach}`
**Files:** `{file patterns}`
**Description:** {What this task accomplishes}

#### Task 2: {Task Name}
**Approach:** `{approach}`
**Files:** `{file patterns}`
**Description:** {What this task accomplishes}

...

#### Task N-1: Principal Review
**Approach:** Run /principal-review
**Description:** Run /principal-review to verify implementation matches the plan and is implemented in the best way.

#### Task N: PR Validation
**Approach:** Run /pr-checker
**Description:** Run /pr-checker before creating PR

### Validation Requirements (from /pr-checker)
{List applicable checks based on files touched}
```

---

## File Pattern → Validation Mapping

When a task touches certain files, note the validation requirement:

| File Pattern | Required Check |
|--------------|----------------|
| `app/repositories/*.ts` | Repository pattern compliance |
| `app/trpc/routes/*.ts` | tRPC validation, Zod inputs |
| `app/routes/**/*.tsx` | Route conventions, auth checks |
| `app/db/schema.ts` | Migration with descriptive name |
| `drizzle/*.sql` | Migration naming convention |
| `app/models/*.ts` | Zod schema standards |
| `app/components/*-modal.tsx` | Modal pattern compliance |
| `e2e/**/*` | Playwright rules |

---

## Task Templates

### Competitive Research Task (when applicable)
```markdown
#### Task: Competitive Research
**Approach:** Use WebSearch tool
**Files:** `docs/research/{feature}-research.md`
**Description:** Use WebSearch to research competitors and UX patterns:
  - Search for similar products/features
  - Analyze common UI patterns
  - Identify differentiation opportunities
  - Document findings in research file
**When to include:** New user-facing features requiring UX decisions
```

### Explore Task
```markdown
#### Task: Explore {Area}
**Approach:** Read and search codebase
**Thoroughness:** quick | medium | very thorough
**Description:** {What to discover}
```

### Implementation Task
```markdown
#### Task: Implement {Feature}
**Approach:** Direct implementation
**Files:** `{file patterns}`
**Description:** {Implementation details}
**PR Checks:** {Applicable validation from file patterns}
```

### Testing Task
```markdown
#### Task: Test Implementation
**Approach:** Bash with playwright + write e2e tests
**Description:** Generate testing plan, verify with browser, write e2e tests
**Outputs:**
  - Browser verification (screenshots)
  - E2E Playwright tests in `e2e/` folder
  - Test summary documentation with screenshots
```

### Testing Workflow
The testing task MUST follow this workflow:

1. **Browser Verification** - Use Bash with playwright to manually verify the feature works
2. **Capture Screenshots** - Take screenshots of key states for documentation
3. **Write E2E Tests** - Convert successful browser actions into Playwright e2e tests
4. **Create Test Summary** - Document test cases with screenshots in `docs/features/`

### Feature Architecture Documentation Task
```markdown
#### Task: Create Feature Architecture Doc
**Approach:** Direct file creation
**Files:** `docs/features/{feature}-architecture.md`
**Description:** Create comprehensive architecture document with:
  - Overview and vision
  - User flow diagrams (mermaid)
  - System architecture diagram
  - Data model (ER diagram + TypeScript interfaces)
  - Feature breakdown
  - UI component hierarchy
  - Frontend design specification
  - API endpoints table
```

### Context Documentation Task
```markdown
#### Task: Update Context Documentation
**Approach:** Direct file editing
**Description:** Update project documentation with new feature/routes/schema summary
```

### Architecture Documentation Task (when applicable)
```markdown
#### Task: Update Architecture Documentation
**Approach:** /architecture-tracker
**Files:** `.cursor/context/high-level-architecture.md`
**Description:** Update living architecture doc with:
  - New routes added to Route Map diagram
  - New rows in Information Architecture table
  - New Feature Flow section (if new feature)
  - Updated Data Relationships (if schema changes)
  - Changelog entry with today's date
**When to include:** New routes, new features, schema changes, architectural decisions
```

### Analytics Task (when applicable)
```markdown
#### Task: Create Analytics Dashboard
**Approach:** Direct implementation
**Description:** Create growth charts/metrics for new data
**Trigger:** Schema adds timestamp/enum/boolean fields, new features with trackable user actions
```

### Logger Task (when applicable)
```markdown
#### Task: Add Debug Logging
**Approach:** Direct implementation
**Files:** `{files being implemented}`
**Description:** Add structured debug logs to trace execution flow
**When to include:** Complex business logic, async operations, error-prone code paths, third-party integrations
**Outputs:**
  - Structured logs with appropriate levels (debug, info, warn, error)
  - Trace logging for request flows
  - Context-rich error logging
```

---

## Example Plan

```markdown
## Implementation Plan: User Preferences Feature

### Overview
Add user preferences table with theme and notification settings,
exposing via tRPC and creating a settings page.

### Tasks

#### Task 1: Explore Existing User Schema
**Approach:** Read and search codebase
**Thoroughness:** quick
**Description:** Understand current user table structure and patterns

#### Task 2: Add Database Schema
**Approach:** Direct implementation
**Files:** `app/db/schema.ts`, `drizzle/*.sql`
**Description:** Add userPreferences table with theme, notifications fields
**PR Checks:** Migration naming (snake_case, descriptive)

#### Task 3: Create Repository
**Approach:** Direct implementation
**Files:** `app/repositories/user-preferences.ts`
**Description:** CRUD operations for preferences with proper error handling
**PR Checks:** Repository pattern, Database type alias, try-catch

#### Task 4: Add tRPC Routes
**Approach:** Direct implementation
**Files:** `app/trpc/routes/user-preferences.ts`, `app/trpc/router.ts`
**Description:** getPreferences, updatePreferences with Zod validation
**PR Checks:** Zod inputs, protectedProcedure usage

#### Task 5: Build Settings Page
**Approach:** Direct implementation
**Files:** `app/routes/settings/preferences.tsx`
**Description:** Form for updating theme and notification preferences
**PR Checks:** Loader auth check, context.trpc usage

#### Task 6: Create Feature Architecture Doc
**Approach:** Direct file creation
**Files:** `docs/features/user-preferences-architecture.md`
**Description:** Create architecture doc with user flows, data model, component hierarchy

#### Task 7: Add Debug Logging
**Approach:** Direct implementation
**Files:** `app/repositories/user-preferences.ts`, `app/trpc/routes/user-preferences.ts`
**Description:** Add structured logs for preference operations (create, update, validation errors)

#### Task 8: Test Implementation
**Approach:** Bash with playwright + write e2e tests
**Description:** Generate testing plan, verify with playwright, write e2e tests

#### Task 9: Update Context Documentation
**Approach:** Direct file editing
**Description:** Add preferences feature summary to project docs

#### Task 10: Update Architecture Documentation
**Approach:** /architecture-tracker
**Description:** Update high-level-architecture.md with new /settings/preferences route, add changelog entry

#### Task 11: Create Analytics Dashboard
**Approach:** Direct implementation
**Description:** Create metrics dashboard for preference usage (theme distribution, notification opt-ins)

#### Task 12: Principal Review
**Approach:** Run /principal-review
**Description:** Verify implementation matches plan and assess implementation quality.

#### Task 13: PR Validation
**Approach:** Run /pr-checker
**Description:** Run validation checklist before creating PR

### Validation Requirements (from /pr-checker)
- [ ] Repository pattern compliance (Task 3)
- [ ] tRPC Zod validation (Task 4)
- [ ] Route auth checks (Task 5)
- [ ] Migration naming convention (Task 2)
- [ ] Feature architecture doc exists (Task 6)
- [ ] Debug logging added (Task 7)
- [ ] Project docs updated (Task 9)
- [ ] high-level-architecture.md updated (Task 10)
- [ ] Testing plan exists (Task 8)
- [ ] Analytics dashboard created (Task 11)
```

---

## Testing Requirements

**CRITICAL: SCREENSHOTS ARE MANDATORY**

**TESTING IS INCOMPLETE WITHOUT SCREENSHOTS.**

Every implementation plan MUST include testing that follows this workflow:

1. **Browser Verification** - Use Bash with playwright to verify the feature works
2. **Capture Evidence** - Take screenshots to `docs/testing/{feature}/screenshots/` **<-- MANDATORY**
3. **Copy to Public** - Copy screenshots to `public/docs/testing/{feature}/screenshots/` **<-- MANDATORY**
4. **Write E2E Tests** - Convert browser actions to `e2e/{feature}.spec.ts`
5. **Document Tests** - Create `docs/testing/{feature}/{feature}.md` with:
   - YAML frontmatter: `title`, `date: YYYY-MM-DD` (use **current date** so the doc sorts correctly in `/admin/docs`)
   - Test scenarios and descriptions
   - **Screenshots embedded with markdown image links** **<-- MANDATORY**
   - Test IDs reference table
   - E2E test coverage list

**Testing task is NOT complete until screenshots are:**
- [ ] Taken with Bash using playwright
- [ ] Saved to `docs/testing/{feature}/screenshots/`
- [ ] Copied to `public/docs/testing/{feature}/screenshots/`
- [ ] Embedded in test documentation markdown file

### Testing Task Example

```markdown
#### Task: Test Implementation
**Approach:** Bash with playwright + write e2e tests
**Description:**
1. Create testing plan at `docs/testing/{feature}/{feature}.md`
2. Verify feature with Bash using playwright
3. **MANDATORY: Save screenshots to `docs/testing/{feature}/screenshots/`**
4. **MANDATORY: Copy screenshots to `public/docs/testing/{feature}/screenshots/`**
5. **MANDATORY: Embed screenshots in test documentation**
6. Write e2e tests in `e2e/{feature}.spec.ts`
7. Add data-testid attributes to key elements

**CRITICAL OUTPUTS (all required):**
- Testing plan: `docs/testing/{feature}/{feature}.md` with embedded screenshots
- Screenshots: `docs/testing/{feature}/screenshots/*.png` (at least 3-5 screenshots)
- Public copy: `public/docs/testing/{feature}/screenshots/*.png`
- E2E test file: `e2e/{feature}.spec.ts`
- Data-testid attributes on all interactive elements

**This task is NOT complete without screenshots in both locations and embedded in documentation.**
```

---

## Final Step: PR Validation Checklist

Always include this at the end of every plan:

```markdown
### Principal Review (before PR validation)

Run /principal-review to verify:
- [ ] Implementation matches the plan (scope, acceptance criteria, data model, APIs)
- [ ] Implementation quality: architecture, patterns, security, maintainability

Then run PR validation below.

### PR Validation (before creating PR)

Run /pr-checker which validates:

- [ ] Code rules compliance (per file patterns above)
- [ ] **Implementation plan saved** (`docs/plans/{feature}-implementation.md`)
- [ ] **Research doc exists** (`docs/research/{feature}-research.md`) - if new user-facing feature
- [ ] **Feature architecture doc exists** (`docs/features/{feature}-architecture.md`)
- [ ] Project docs updated (if feature/architecture change)
- [ ] Testing plan exists (`docs/testing/{feature}/`)
- [ ] **E2E tests written in `e2e/`**
- [ ] Migrations use /db-migration (if applicable)
- [ ] **Debug logging added** (if complex logic/integrations)
- [ ] **Analytics dashboard created** (if new trackable data)
```

---

## Quick Reference

| Work Type | Typical Task Order |
|-----------|-------------------|
| New feature (user-facing) | research (WebSearch) → explore → implement → logger → tester → docs → architecture-tracker → analytics |
| New feature (backend) | explore → implement → logger → tester → docs → architecture-tracker → analytics |
| Bug fix | explore → implement → logger → tester |
| Refactor | explore → implement → tester |
| UI-only change | implement → tester → docs |
| Analytics addition | implement analytics |
| Schema change | implement → analytics → tester → architecture-tracker |
| Complex integration | explore → implement → logger → tester → docs → architecture-tracker |
| New routes only | implement → tester → architecture-tracker |

## Documentation Checklist

| Doc Type | Location | When Required |
|----------|----------|---------------|
| **Plan** | `docs/plans/{feature}-implementation.md` | All new features |
| Research | `docs/research/{feature}-research.md` | New user-facing features |
| Architecture | `docs/features/{feature}-architecture.md` | New features with multiple layers |
| Testing | `docs/testing/{feature}/{feature}.md` | All features |
| Context | Project documentation | All features/changes |
| High-Level Architecture | `.cursor/context/high-level-architecture.md` | New routes, features, schema changes |

**Important:** After implementation is complete, save the plan to `docs/plans/` for future reference.
| Debug Logs | In implementation files | Complex logic, integrations, error-prone paths |
| Analytics | Admin dashboard | Features with trackable data (signups, usage, conversions) |
