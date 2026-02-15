---
description: Creates GitHub PRs with descriptions following the team's template structure
argument-hint: [PR context or branch description]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Create Pull Request

Create GitHub PRs with descriptions following the team's template structure.

PR context: $ARGUMENTS

## Before Creating PR

**IMPORTANT: Run /pr-checker first** to validate changes follow project rules.

Read `CLAUDE.md` for the compressed Rules Index. Ensure all touched files comply with their respective rules before creating the PR.

### Pre-PR Documentation Checklist

For feature PRs, ensure these are updated:
- [ ] Project documentation updated
- [ ] `high-level-architecture.md` updated (via /architecture-tracker) - if new routes, features, or schema changes
- [ ] Testing plan exists with screenshots

## Workflow

### Step 1: Gather Context

Run these commands in parallel to understand the changes:

```bash
# Check current branch and status
git status

# Get diff against main (staged and unstaged)
git diff main...HEAD

# View commit history since branching from main
git log main..HEAD --oneline

# Get current branch name (for Linear ticket extraction)
git branch --show-current
```

### Step 2: Extract Linear Tickets

Parse the branch name for Linear ticket IDs:

| Branch Format | Extracted Ticket |
|---------------|------------------|
| `LAN-123-feature-name` | `LAN-123` |
| `feature/LAN-456-description` | `LAN-456` |
| `fix/LAN-789` | `LAN-789` |

Pattern: Look for `LAN-` followed by numbers.

### Step 3: Check for Testing Plan

Look for any generated testing plans in these locations:

- `e2e/*.spec.ts` - E2E test files
- `docs/testing/{feature}/{feature}.md` - Testing plans with screenshots
- `docs/testing/{feature}/screenshots/` - Playwright screenshots
- Recent conversation context mentioning test scenarios

If a testing plan exists, include its test cases in the PR description.

### Step 3.5: Gather Screenshots for PR

**ALWAYS include screenshots** when UI changes are part of the PR. Search for available screenshots:

```bash
# Check testing screenshots
ls docs/testing/*/screenshots/*.png 2>/dev/null

# Check concept/design images
ls public/docs/features/*/*.png 2>/dev/null

# Check any other image assets added in this branch
git diff main...HEAD --name-only | grep -E '\.(png|jpg|jpeg|gif|webp)$'
```

**Screenshot URL Format:**
Use GitHub raw URLs so images render in the PR description:
```
https://github.com/{owner}/{repo}/blob/{branch}/path/to/image.png?raw=true
```

**Prioritize these screenshot types:**
1. **Testing screenshots** - Actual UI from `docs/testing/{feature}/screenshots/`
2. **Concept images** - Design concepts from `public/docs/features/{feature}/`
3. **Before/After comparisons** - When refactoring UI

**Screenshot categories to include:**
- Empty states
- Filled/populated states
- Form validation errors
- Success states
- New UI components
- Navigation changes

### Step 3.6: Create Release Documentation (for `feat` PRs)

For feature PRs, create a release document in `docs/releases/`:

**Filename:** `YYYY-MM-DD-feature-name.md` (e.g., `2026-01-24-documentation-viewer.md`)

**Template:**

```markdown
# Feature Name Release

**Date:** YYYY-MM-DD

## Summary
Brief description of what this release adds.

## New Features
- Feature 1 with description
- Feature 2 with description

## Key Files
| File | Description |
|------|-------------|
| `path/to/file.tsx` | What it does |

## Bug Fixes
- Fix description (or "None - initial release.")

## Breaking Changes
- Breaking change (or "None.")

## Dependencies Added
- `package-name` - What it's used for (if any)
```

This documents the release for the changelog and provides a historical record.

### Step 4: Determine PR Type

Based on the changes, select the appropriate type:

| Type | When to Use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `refactor` | Code restructure, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build, config, dependencies |
| `revert` | Reverting previous changes |
| `rfc` | Request for comments / proposal |

### Step 5: Get Repository Info

Extract owner and repo from the git remote:

```bash
git remote get-url origin
```

Parse the URL to extract `owner` and `repo`:
- `git@github.com:owner/repo.git` → owner: `owner`, repo: `repo`
- `https://github.com/owner/repo.git` → owner: `owner`, repo: `repo`

### Step 6: Push and Create the PR

1. **Push the branch:**
   ```bash
   git push -u origin HEAD
   ```

2. **Use the `gh` CLI to create the PR:**

   ```bash
   gh pr create \
     --title "TYPE: Brief description" \
     --base main \
     --body "formatted PR description"
   ```

   The `body` should follow the template below.

3. **Return the PR URL** to the user.

## PR Description Template (for `body` parameter)

Fill each section based on the diff analysis:

### Pull Request Type
Single word from the type list above.

### Purpose
- 1-3 sentences explaining WHAT changed and WHY
- Focus on the user/business value
- Reference specific files/components if helpful

### Linear Tickets
- Format: `- LAN-XXX`
- Extract from branch name
- Add any additional related tickets

### Breaking Changes
- List specific breaking changes with migration steps
- Or state "None" explicitly

### Screenshots
Include screenshots when UI changes are present. Use GitHub raw URLs:

```markdown
## Screenshots

### Feature Name
![Description](https://github.com/{owner}/{repo}/blob/{branch}/path/to/screenshot.png?raw=true)

### Another Feature
![Description](https://github.com/{owner}/{repo}/blob/{branch}/path/to/another.png?raw=true)
```

Group screenshots by feature area with descriptive headers. If no UI changes, omit this section entirely (don't write "None").

### Test Cases
Create actionable checkbox items:
```markdown
- [ ] Navigate to /feature and verify X displays
- [ ] Click button Y and confirm Z happens
- [ ] Test edge case: empty state shows message
```

If a testing plan was generated, incorporate those test cases here.

### Notes
- Implementation decisions
- Known limitations
- Areas needing extra review attention
- Dependencies or follow-up work

## Example Output

```markdown
## Pull Request Type
feat

## Purpose
Add user preferences page allowing users to customize notification settings and display options. This addresses user feedback requesting more control over their experience.

## Linear Tickets
- LAN-234

## Breaking Changes
None

## Screenshots

### Preferences Page (Empty State)
![Empty preferences](https://github.com/acme/app/blob/feat/preferences/docs/testing/preferences/screenshots/preferences-empty.png?raw=true)

### Preferences Page (Filled)
![Filled preferences](https://github.com/acme/app/blob/feat/preferences/docs/testing/preferences/screenshots/preferences-filled.png?raw=true)

### Dark Mode Toggle
![Dark mode](https://github.com/acme/app/blob/feat/preferences/docs/testing/preferences/screenshots/dark-mode.png?raw=true)

## Test Cases
- [ ] Navigate to /settings/preferences and verify page loads
- [ ] Toggle email notifications and verify setting persists after refresh
- [ ] Change theme to dark mode and verify UI updates
- [ ] Test with new user (no existing preferences)

## Notes
- Preferences are stored in the existing user_settings table
- Default values match current hardcoded behavior

## Self Checklist
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] `bun run build` succeeds
- [ ] Feature flag created if needed
- [ ] Code reviewed against conventions
- [ ] Database migration does NOT delete data
- [ ] Release doc created in `docs/releases/` (for feat PRs)
```

## Tips

- **Keep Purpose scannable** - reviewers should understand the change in seconds
- **Be specific in Test Cases** - vague tests get skipped
- **Don't leave Breaking Changes blank** - always state "None" or list them
- **ALWAYS include screenshots for UI changes** - check `docs/testing/*/screenshots/` and `public/docs/features/*/`
- **Use descriptive screenshot headers** - group by feature area (e.g., "### Form Validation", "### Empty State")
- **Prefer actual screenshots over concepts** - testing screenshots show real implementation
