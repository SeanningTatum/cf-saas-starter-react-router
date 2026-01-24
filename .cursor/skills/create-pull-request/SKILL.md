---
name: create-pull-request
description: Create a GitHub pull request with a properly formatted description. Use when the user asks to create a PR, open a pull request, submit changes for review, or push and create PR.
---

# Create Pull Request

Create GitHub PRs with descriptions following the team's template structure.

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

- `test-results/` directory
- `TEST_PLAN.md` or `TESTING.md` files
- Recent conversation context mentioning test scenarios

If a testing plan exists, include its test cases in the PR description.

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

2. **Use the GitHub MCP to create the PR:**

   Call the `create_pull_request` tool from the `user-github` MCP server:

   ```
   MCP Tool: user-github / create_pull_request
   Arguments:
     owner: "<repository owner>"
     repo: "<repository name>"
     title: "TYPE: Brief description"
     head: "<current branch name>"
     base: "main"
     body: "<formatted PR description>"
   ```

   The `body` should follow the template below.

3. **Return the PR URL** from the MCP response to the user.

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
```

## MCP Tool Reference

**Server:** `user-github`
**Tool:** `create_pull_request`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `owner` | Yes | Repository owner (e.g., "acme-corp") |
| `repo` | Yes | Repository name (e.g., "my-app") |
| `title` | Yes | PR title (e.g., "feat: Add user preferences") |
| `head` | Yes | Branch with changes (your current branch) |
| `base` | Yes | Target branch (typically "main") |
| `body` | No | PR description (use the template above) |
| `draft` | No | Create as draft PR (boolean) |

## Tips

- **Keep Purpose scannable** - reviewers should understand the change in seconds
- **Be specific in Test Cases** - vague tests get skipped
- **Don't leave Breaking Changes blank** - always state "None" or list them
- **Include screenshots for UI changes** in the Notes section
