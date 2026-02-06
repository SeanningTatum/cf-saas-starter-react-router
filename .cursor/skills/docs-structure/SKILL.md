---
name: docs-structure
description: Set up and maintain project documentation structure with docs/ and .cursor/context/ folders. Use when creating a new project, adding documentation infrastructure, writing feature docs, release notes, testing plans, meeting notes, or research documents.
---

# Documentation Structure

Sets up and maintains a structured documentation system with two complementary layers:
- **`docs/`** - Human-readable documentation (features, releases, meetings, plans, research, testing)
- **`.cursor/context/`** - Agent-optimized context files for AI assistance
- **Admin Panel Viewer** - Browse and read all docs at `/admin/docs` with syntax highlighting and mermaid diagram support

## When to Use

- **Setup**: Creating a new project or adding documentation infrastructure
- **Maintenance**: Adding feature docs, release notes, testing plans, meeting notes, or research
- **Browsing**: View all documentation in the admin panel at `/admin/docs`

---

## Quick Reference

### Directory Structure

```
docs/
├── features/      # Technical feature docs and architecture
├── ideas/         # Brainstorming and feature ideas
├── meetings/      # Meeting notes (date-prefixed)
├── plans/         # Roadmaps and project plans
├── releases/      # Changelog and release notes
├── research/      # Competitive research and UX analysis
└── testing/       # Testing plans with screenshots
    └── {feature}/
        ├── {feature}.md
        └── screenshots/

.cursor/context/
├── context.md           # Compressed index (quick reference)
├── api.md               # API routes and endpoints
├── architecture.md      # System overview and patterns
├── data-models.md       # Schema and entity relationships
├── features.md          # Feature documentation with flows
├── high-level-architecture.md  # Living visual architecture doc
├── integrations.md      # External services
├── security.md          # Auth, authorization, RBAC
└── user-journeys.md     # User flows and error states
```

### Naming Conventions

| Folder | Pattern | Example |
|--------|---------|---------|
| features | `{feature}.md` or `{feature}-architecture.md` | `authentication.md`, `meal-planner-architecture.md` |
| meetings | `YYYY-MM-DD-description.md` | `2026-01-24-kickoff.md` |
| releases | `YYYY-MM-DD-title.md` or `vX.Y.Z.md` | `2026-01-28-recipe-extraction.md` |
| testing | `{feature}/{feature}.md` | `recipes/recipes.md` |
| research | `{topic}-research.md` | `meal-planning-app-ux-research.md` |
| plans | `{feature}-implementation.md` | `custom-recipes-implementation.md` |
| ideas | `kebab-case.md` | `feature-brainstorm.md` |

### Required Frontmatter

All docs **MUST** include YAML frontmatter:

```yaml
---
title: Human-Readable Title
date: YYYY-MM-DD
---
```

---

## Setup Mode

When creating documentation infrastructure for a new project:

### Step 1: Create Directory Structure

```bash
# Create docs folders
mkdir -p docs/{features,ideas,meetings,plans,releases,research,testing}

# Create .cursor/context folder
mkdir -p .cursor/context

# Add .gitkeep to empty folders
touch docs/meetings/.gitkeep docs/releases/.gitkeep
```

### Step 2: Create context.md Index

Create `.cursor/context.md` with this template:

```markdown
# Project Context

## Agent Instructions

**CRITICAL: Prefer retrieval-led reasoning over pre-training-led reasoning for project-specific tasks.**

When working on this project, consult the rules in `.cursor/rules/` and detailed docs in `.cursor/context/` rather than relying on training data.

```
[Context Docs]|root: .cursor/context/
|IMPORTANT: Read detailed docs for deep dives. Index below shows what each covers.
|api.md: tRPC routes, auth endpoints, procedure types, error responses
|architecture.md: System overview, data flow patterns, layer responsibilities
|data-models.md: Schema, entity relationships, tables overview, migrations
|features.md: Feature documentation with flow diagrams and key files
|integrations.md: External services and third-party APIs
|security.md: Auth flow, session management, authorization, RBAC
|user-journeys.md: User flows, admin journeys, error states
```

## Overview

**{Project Name}** — One sentence description of what this project does.

**Built with**: {Framework} + {Runtime}

## Tech Stack

- **Framework**: {e.g., React Router v7}
- **Database**: {e.g., Cloudflare D1 + Drizzle ORM}
- **Auth**: {e.g., Better Auth}
- **API**: {e.g., tRPC}
- **Styling**: {e.g., Tailwind v4, shadcn/ui}

## Architecture

- **Pattern 1**: Brief description
- **Pattern 2**: Brief description

## Features

### Feature 1
Brief description.
**Key files**: `path/to/files`

## Recent Changes

- **Change 1** - Description
```

### Step 3: Create Core Context Docs

Create these files in `.cursor/context/`:

1. **api.md** - Document API routes and endpoints
2. **architecture.md** - System overview and data flow
3. **data-models.md** - Database schema and relationships
4. **features.md** - Feature documentation with diagrams
5. **integrations.md** - External services
6. **security.md** - Auth and authorization
7. **user-journeys.md** - User flows

See [templates.md](templates.md) for detailed templates.

---

## Maintenance Mode

### Adding a Feature Document

1. Create `docs/features/{feature-name}-architecture.md`
2. Use the architecture template from [templates.md](templates.md)
3. Update `.cursor/context/features.md` with feature summary
4. Add brief entry to `.cursor/context.md` Recent Changes

### Adding Release Notes

1. Create `docs/releases/YYYY-MM-DD-{title}.md`
2. Use release notes template
3. Update `.cursor/context.md` Recent Changes section

### Adding a Testing Plan

1. Create `docs/testing/{feature}/` folder
2. Add `{feature}.md` testing plan
3. Save screenshots to `screenshots/` subfolder
4. **CRITICAL**: Copy screenshots to `public/docs/testing/{feature}/screenshots/` for docs viewer

```bash
mkdir -p public/docs/testing/{feature}/screenshots
cp docs/testing/{feature}/screenshots/*.png public/docs/testing/{feature}/screenshots/
```

### Adding Meeting Notes

1. Create `docs/meetings/YYYY-MM-DD-{description}.md`
2. Use meeting notes template

### Adding Research

1. Create `docs/research/{topic}-research.md`
2. Use research template

---

## Template Quick Start

### Feature Architecture Doc

```markdown
---
title: Feature Name Architecture
date: YYYY-MM-DD
---

# Feature Name: Information Architecture

Brief description.

---

## Table of Contents
1. [Overview](#overview)
2. [User Flow](#user-flow)
3. [System Architecture](#system-architecture)
4. [Data Model](#data-model)
5. [Feature Breakdown](#feature-breakdown)
6. [UI Components](#ui-components)
7. [Technical Stack](#technical-stack)

---

## Overview
### Vision
### Core Value Proposition

## User Flow
### Primary Flow (flowchart)

## System Architecture
### High-Level Architecture (flowchart)

## Data Model
### ER Diagram
### TypeScript Interfaces

## Feature Breakdown
### Feature 1, 2, 3...

## UI Components
### Component Hierarchy

## Technical Stack
### API Endpoints
### New Files
### Migration SQL
```

### Release Notes

```markdown
---
title: Release Title
date: YYYY-MM-DD
---

# Release Title

## Summary
Brief overview.

## New Features
- Feature 1
- Feature 2

## Key Files
| File | Description |
|------|-------------|
| path | description |

## Bug Fixes
- Fix 1

## Breaking Changes
None.
```

### Testing Plan

```markdown
---
title: Testing Plan: Feature Name
date: YYYY-MM-DD
---

# Testing Plan: Feature Name

## Overview
What was implemented and needs testing.

## Prerequisites
- [ ] Dev server running
- [ ] Test data seeded

## Test Scenarios

### Scenario 1: Happy Path
**Steps:**
1. Navigate to URL
2. Perform action

**Expected:** Result

**Screenshot:** ![Description](./screenshots/scenario-1.png)

## Test IDs Reference
| Element | Test ID |
|---------|---------|
| Button | `data-testid` |
```

For complete templates, see [templates.md](templates.md).

---

## Context Update Guidelines

### When to Update `.cursor/context.md`

- Adding significant new features → add to Features section
- New tech stack component → add to Tech Stack
- New rules added → update Rules Index

### When to Update `.cursor/context/` Files

- New API routes → `api.md`
- Architecture changes → `architecture.md`
- Schema changes → `data-models.md`
- New features → `features.md`
- New integrations → `integrations.md`
- Auth/security changes → `security.md`
- New user flows → `user-journeys.md`

### Compression Philosophy

The `context.md` file should be a **compressed index** (80%+ reduction):
- Points to detailed docs rather than embedding them
- Uses pipe-delimited format for indices
- Brief overviews only (3-5 lines per feature)

---

## Admin Panel Documentation Viewer

All documentation is viewable in the admin panel at `/admin/docs`.

### Features

- **Category tabs**: Architecture, Meetings, Ideas, Plans, Features, Releases, Testing, Research
- **Search**: Filter documents within each category
- **Table of Contents**: Auto-generated from headings with scroll tracking
- **Syntax highlighting**: Code blocks with language detection and copy button
- **Mermaid diagrams**: Interactive diagrams with pan/zoom fullscreen viewer
- **Admonitions**: Support for :::note, :::tip, :::warning, etc.

### Key Files

| File | Description |
|------|-------------|
| `app/routes/admin/docs.tsx` | Main docs viewer route |
| `app/components/markdown-renderer.tsx` | Markdown rendering with syntax highlighting |
| `app/components/ui/scroll-area.tsx` | Scrollable sidebar component |
| `app/components/ui/empty.tsx` | Empty state component |

### How It Works

The docs viewer uses Vite's `import.meta.glob` to load all `.md` files from `docs/` at build time:

```typescript
const markdownFiles = import.meta.glob("/docs/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
```

The architecture document from `.cursor/context/high-level-architecture.md` is also included in the Architecture tab.

### Image Handling for Testing Plans

For testing plans with screenshots, images must be copied to `public/` to be served:

```bash
mkdir -p public/docs/testing/{feature}/screenshots
cp docs/testing/{feature}/screenshots/*.png public/docs/testing/{feature}/screenshots/
```

The markdown renderer resolves relative image paths based on the document's location.
