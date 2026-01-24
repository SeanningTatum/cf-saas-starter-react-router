---
name: pr-checker
description: Validate pull requests against project standards before submission. Use proactively before creating PRs, when reviewing changes, or when the user mentions PR review, code review, or checking changes.
---

# PR Checker

Validate that changes follow project standards before creating a pull request.

## When to Run

**Run this skill proactively** before using the `create-pull-request` skill. This ensures all requirements are met before PR creation.

## Validation Checklist

Copy and track progress:

```
PR Validation:
- [ ] 1. Code rules compliance
- [ ] 2. context.md updated (if feature/architecture change)
- [ ] 3. Testing plan exists
- [ ] 4. Migrations use db-migration skill (if applicable)
- [ ] 5. Ready for create-pull-request skill
```

---

## Step 1: Gather Changed Files

```bash
# Get list of changed files
git diff main...HEAD --name-only

# Get the actual diff for review
git diff main...HEAD
```

---

## Step 2: Check Code Rules Compliance

For each changed file, verify it follows the appropriate rule based on file location:

| File Pattern | Rule to Check |
|--------------|---------------|
| `app/repositories/*.ts` | `repository-pattern.mdc` |
| `app/trpc/routes/*.ts` | `repository-pattern.mdc` |
| `app/routes/**/*.tsx` | `routes.mdc` |
| `app/db/schema.ts` | `database.mdc` |
| `app/models/*.ts` | `models.mdc` |
| `app/models/errors/*.ts` | `errors.mdc` |
| `app/components/*-modal.tsx` | `modals.mdc` |
| `app/prompts/*.ts` | `prompts.mdc` |
| `**/stripe*`, `**/payment*` | `stripe.mdc` |
| `e2e/**/*` | `playwright-rules.mdc` |
| `app/lib/constants/*` | `constants.mdc` |

### Verification Process

1. Read the applicable rule file from `.cursor/rules/`
2. Review the changed code against rule requirements
3. Flag any violations

### Common Violations to Check

**Repository files:**
- ❌ Missing `Database` type alias
- ❌ Importing tRPC or request objects
- ❌ Missing try-catch with custom error types
- ❌ Accessing context/session directly

**tRPC routes:**
- ❌ Missing Zod input validation
- ❌ Not using appropriate procedure type
- ❌ Direct database access (should use repositories)

**Route files:**
- ❌ Missing loader authentication check
- ❌ Not using `context.trpc` for data fetching

---

## Step 3: Check context.md Updates

**Required when:** Adding features, changing architecture, modifying API routes, or updating database schema.

### Verify context.md

```bash
# Check if context.md was modified
git diff main...HEAD --name-only | grep -q "context.md"
```

**If feature/architecture changes exist but context.md is unchanged:**

1. Read current `context.md`:
   ```bash
   cat .cursor/context.md
   ```

2. Identify what should be added:
   - New features → Add to `## Features` section
   - New API routes → Add to `## API Routes` section
   - Schema changes → Add to `## Database` section
   - Architecture changes → Update `## Architecture` section

3. **Prompt user:** "context.md needs updating. Should I add the new [feature/route/schema] to context.md?"

### context.md Update Template

Add to the `## Recent Changes` section:

```markdown
## Recent Changes
- [DATE] Added [feature name] - [brief description]
```

---

## Step 4: Verify Testing Plan Exists

Check for testing documentation:

```bash
# Check for testing plan files
ls -la test-results/ 2>/dev/null
ls -la TEST_PLAN.md TESTING.md 2>/dev/null
```

### If No Testing Plan Found

**Prompt user:** "No testing plan found. Before creating the PR, run the `tester` subagent to generate a testing plan and verify the implementation."

The testing plan should include:
- Test scenarios for the feature
- Steps to verify functionality
- Expected outcomes

---

## Step 5: Check Migration Compliance

**Only if `drizzle/` files were changed or `app/db/schema.ts` was modified.**

### Verify Migration Naming

```bash
# List recent migrations
ls -la drizzle/*.sql | tail -5
```

**Check naming convention:**
- ✅ `0001_add_user_preferences.sql` (snake_case, descriptive)
- ❌ `0001_migration.sql` (generic)
- ❌ `0001_AddUserPreferences.sql` (not snake_case)

### If Schema Changed Without Migration

**Prompt user:** "Schema changes detected but no new migration. Run `bun run db:generate --name 'descriptive_name'` using the db-migration skill."

---

## Step 6: Final Validation Report

Generate a summary:

```markdown
## PR Validation Report

### Code Rules
- [✅/❌] Repository pattern compliance
- [✅/❌] tRPC route validation
- [✅/❌] Route conventions

### Documentation
- [✅/❌] context.md updated
- [✅/❌] Testing plan exists

### Database
- [✅/❌] Migration naming convention
- [✅/❌] No data-deleting migrations

### Ready for PR
- [✅/❌] All checks passed
```

---

## Proceed to PR Creation

**Only after all checks pass**, use the `create-pull-request` skill to create the PR.

If checks fail, address the issues first:
1. Fix code rule violations
2. Update context.md
3. Generate testing plan with tester subagent
4. Generate migrations with db-migration skill

---

## Quick Reference: Skills to Use

| Task | Skill |
|------|-------|
| Generate migration | `db-migration` |
| Create pull request | `create-pull-request` |
| Generate testing plan | `tester` subagent |
