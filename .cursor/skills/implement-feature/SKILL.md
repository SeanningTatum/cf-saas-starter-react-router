---
name: implement-feature
description: Executes feature implementation with automatic subagent delegation following project best practices. Use when implementing new features, building functionality, or when a task requires multiple layers (DB, API, UI). Automatically delegates to context-keeper, data-analytics, tester, logger, and figma converters as needed.
---

# Implement Feature

Execute feature implementations by automatically delegating to specialized subagents based on what the feature requires.

## When to Use

- Implementing a new feature (any scope)
- Building functionality that touches multiple layers
- After planning, when ready to execute
- Any task where subagent delegation would improve quality

## Workflow

### Step 1: Analyze Feature Scope

Determine what the feature requires:

| Scope | Indicators | Layers Affected |
|-------|------------|-----------------|
| **Full-stack** | New data model, CRUD operations | DB → Repository → tRPC → UI |
| **Backend** | API changes, business logic | Repository → tRPC |
| **Frontend** | UI changes, components | Components → Routes |
| **Integration** | External services, webhooks | Repository → tRPC → possibly UI |

### Step 2: Map to Subagent Execution Order

Execute subagents in dependency order:

```
┌─────────────────────────────────────────────────────────────┐
│                    IMPLEMENTATION PHASE                      │
├─────────────────────────────────────────────────────────────┤
│  1. Core Implementation (generalPurpose)                    │
│     └─ Schema → Repository → tRPC → Components → Routes     │
│                                                              │
│  2. Figma Integration (if applicable)                       │
│     ├─ figma-to-tailwind-converter (for design code)        │
│     └─ figma-design-validator (verify implementation)       │
│                                                              │
│  3. Logging (logger) - Add structured debug logs            │
├─────────────────────────────────────────────────────────────┤
│                    VALIDATION PHASE                          │
├─────────────────────────────────────────────────────────────┤
│  4. Testing (tester)                                        │
│     └─ Browser verification → E2E tests → Documentation     │
│                                                              │
│  5. Analytics (data-analytics) - if schema has metrics      │
├─────────────────────────────────────────────────────────────┤
│                    DOCUMENTATION PHASE                       │
├─────────────────────────────────────────────────────────────┤
│  6. Context Update (context-keeper)                         │
│     └─ Update context.md with new feature                   │
└─────────────────────────────────────────────────────────────┘
```

### Step 3: Execute with Delegation

For each phase, invoke the appropriate subagent using the Task tool:

```typescript
// Pattern for subagent delegation
Task({
  subagent_type: "subagent-name",
  description: "Brief description",
  prompt: "Detailed instructions including context",
  model: "fast" // Use for straightforward tasks
})
```

---

## Subagent Delegation Guide

### Core Implementation: `generalPurpose`

**When:** Always (main implementation work)

**Delegation Pattern:**
```markdown
Implement {feature} following the project's architecture:

**Repository Layer** (`app/repositories/{name}.ts`):
- Define `type Database = Context["db"];`
- Export pure functions with signature `async function name(db: Database, input: InputInterface)`
- Wrap operations in try-catch, throw custom errors from `@/models/errors`

**tRPC Routes** (`app/trpc/routes/{name}.ts`):
- Import repository as `import * as {name}Repository from "@/repositories/{name}";`
- Use Zod for input validation
- Use appropriate procedure type (publicProcedure, protectedProcedure, adminProcedure)

**UI Components/Routes**:
- Use `context.trpc` in loaders
- Use `api.{route}.{method}.useQuery/useMutation` in components
```

### Figma Conversion: `figma-to-tailwind-converter`

**When:** Receiving code from Figma MCP with hardcoded colors

**Triggers:**
- Hex values like `bg-[#003362]`
- Tailwind default palette (`bg-blue-600`, `text-gray-900`)
- RGB/OKLCH values

**Delegation Pattern:**
```markdown
Convert this Figma output to use project CSS variables:

{paste code}

Convert following priority:
1. Semantic colors (bg-background, text-foreground, bg-primary)
2. Text hierarchy (text-text-heading, text-muted-foreground)
3. Brand palette (bg-brand-500) if semantic doesn't fit
```

### Design Validation: `figma-design-validator`

**When:** After implementing any UI from Figma designs

**Delegation Pattern:**
```markdown
Validate the implementation at {route} against the Figma design.

1. Extract design specs using Figma MCP
2. Navigate to implementation with Playwright MCP
3. Compare: layout, typography, colors, spacing
4. Document any discrepancies
5. Flag if hardcoded colors found (should use CSS variables)
```

### Logging: `logger`

**When:** After implementing features with business logic

**Delegation Pattern:**
```markdown
Add structured logging to the new {feature} implementation:

Files to add logging:
- `app/repositories/{name}.ts` - Use `loggers.repository`
- `app/trpc/routes/{name}.ts` - Use `loggers.trpc`
- `app/routes/{path}.tsx` - Use `createRequestLogger("loader")`

Add logs for:
- Entry/exit points with timing
- State changes (before/after)
- Errors with context
- Authentication checks
```

### Testing: `tester`

**When:** After core implementation is complete

**Delegation Pattern:**
```markdown
Test the {feature} implementation:

1. Create testing plan at `.cursor/testing-plans/{feature}.md`
2. Verify with Playwright MCP:
   - Navigate to {route}
   - Test happy path: {steps}
   - Test edge cases: {cases}
   - Test error handling: {scenarios}
3. Write E2E tests at `e2e/{feature}.spec.ts`
4. Create test documentation at `docs/features/{feature}-testing.md`
5. Add data-testid attributes to interactive elements
```

### Analytics: `data-analytics`

**When:** Schema includes timestamp, enum, or boolean fields worth tracking

**Triggers:**
- New `createdAt` fields → time-series growth charts
- New enum fields → distribution charts
- New boolean fields → conversion metrics

**Delegation Pattern:**
```markdown
Create analytics for the new {table/feature}:

Schema fields to analyze:
- {field}: {type} → {chart type}

Create:
1. Repository functions in `app/repositories/analytics.ts`
2. tRPC routes in `app/trpc/routes/analytics.ts`
3. Dashboard components using `@/components/analytics`
```

### Documentation: `context-keeper`

**When:** Always (after implementation complete)

**Delegation Pattern:**
```markdown
Update context.md with the new {feature}:

Add to Features section:
- What it does
- Key files involved
- Important implementation details

Update Recent Changes with brief summary.

If applicable, add Mermaid diagrams for:
- Data flow
- User flows
- Schema relationships
```

---

## Execution Decision Tree

```
Is this a UI implementation from Figma?
├─ Yes → 1. generalPurpose (implement)
│        2. figma-to-tailwind-converter (if hardcoded colors)
│        3. figma-design-validator (verify match)
│        4. tester
│        5. context-keeper
│
└─ No → Does it involve database/API changes?
        ├─ Yes → 1. generalPurpose (full-stack)
        │        2. logger
        │        3. tester
        │        4. data-analytics (if new metrics)
        │        5. context-keeper
        │
        └─ No → 1. generalPurpose (frontend-only)
                2. tester
                3. context-keeper
```

---

## Quick Reference

| Subagent | Trigger | Output |
|----------|---------|--------|
| `generalPurpose` | Always | Core implementation |
| `figma-to-tailwind-converter` | Figma code with hardcoded colors | Converted code |
| `figma-design-validator` | After Figma implementation | Validation report |
| `logger` | Features with business logic | Structured logs |
| `tester` | After implementation | Tests + documentation |
| `data-analytics` | New trackable data | Dashboard |
| `context-keeper` | Always (last) | Updated context.md |

---

## Example Execution

### Full-Stack Feature: User Preferences

```markdown
**Feature:** Add user preferences with theme and notification settings

**Scope Analysis:** Full-stack (new table, CRUD, settings page)

**Execution:**

1. **generalPurpose** → Implement schema, repository, tRPC, UI
2. **logger** → Add logging to repository and tRPC
3. **tester** → Verify settings page, write e2e tests
4. **data-analytics** → Skip (no meaningful metrics for preferences)
5. **context-keeper** → Document new feature in context.md
```

### Frontend Feature from Figma

```markdown
**Feature:** Implement dashboard card design from Figma

**Scope Analysis:** Frontend (component from design)

**Execution:**

1. **generalPurpose** → Build component structure
2. **figma-to-tailwind-converter** → Convert colors to CSS variables
3. **figma-design-validator** → Verify implementation matches design
4. **tester** → Visual verification, screenshot documentation
5. **context-keeper** → Document new component
```

---

## Checklist

Before marking implementation complete:

- [ ] Core implementation follows repository pattern
- [ ] tRPC routes use Zod validation
- [ ] Routes check authentication appropriately
- [ ] Figma implementations use CSS variables (no hardcoded colors)
- [ ] Structured logging added to key operations
- [ ] E2E tests written and passing
- [ ] Test documentation created with screenshots
- [ ] context.md updated with new feature
- [ ] Analytics dashboard created (if applicable)
