---
description: Transforms discovery insights into an actionable UX Brief with JTBD, ICP, and success metrics
argument-hint: <strategy request or project name>
allowed-tools: Read, Write, Edit, Glob, Grep
---

# UX Strategist

The UX Strategist transforms raw discovery insights into a concrete, actionable UX Brief. This skill synthesizes findings into buildable scope by identifying the primary job-to-be-done (JTBD), core user persona (ICP), constraints, and success metrics. The output is a strategic contract between research and design teams.

Strategy request: $ARGUMENTS

## Workflow

### Prerequisites
- Discovery Report exists at `projects/[project-name]/01-discovery/DISCOVERY-REPORT.md`
- If missing, user must run /discovery-agent first

### Step 1: Identify Active Project
Find the active project in `projects/` (non-_example-project folders)

### Step 2: Gather Input Documents
- Read Discovery Report: `projects/[project-name]/01-discovery/DISCOVERY-REPORT.md`
- Read References: `references/JTBD-GUIDE.md`, `references/ICP-GUIDE.md`, `references/DESIGN-PRINCIPLES.md`
- Read Template: `templates/02-ux-strategy/UX-BRIEF.md`

### Step 3: Make Strategic Decisions
- **Primary JTBD**: Choose ONE job-to-be-done; secondary jobs listed but don't drive scope
- **Primary ICP**: Select ONE user persona with design implications; secondary ICPs provide context
- **Constraints**: List technical, business, and user constraints as committed decisions
- **Anti-Goals**: Be specific and decisive—no tentative "probably won't" language
- **Success Criteria**: Define measurable outcomes
- **Core Flows**: List 3-5 flows that must be designed

### Step 4: Write the Brief
Fill `templates/02-ux-strategy/UX-BRIEF.md` with:
- Problem statement (grounded in discovery)
- Primary JTBD (optimized language)
- Primary ICP with design implications
- Constraints (technical, business, user)
- Anti-goals (firm decisions)
- Success criteria (measurable)
- Core flows to design
- Direction hypothesis
- Client summary (one paragraph, works standalone)

### Step 5: Save & Stop
Write completed brief to: `projects/[project-name]/02-ux-strategy/UX-BRIEF.md`

**Do NOT proceed to the next skill.**

## Quality Gates

Before finalizing, verify:
- **Decisiveness**: Could another designer pick this up and know exactly what to build?
- **Scope**: Is it tight enough to ship in the agreed timeline?
- **Anti-Goals**: Are they specific commitments, not wishy-washy language?
- **Client Summary**: Does it work as a standalone alignment document?

## Key Principles

- The UX Brief is the contract between research and design—it must be decisive
- Prioritize ONE primary JTBD and ONE primary ICP; secondary items provide context only
- Anti-goals are committed decisions, not tentative suggestions
- Client summary should be immediately actionable and clear enough to stand alone
