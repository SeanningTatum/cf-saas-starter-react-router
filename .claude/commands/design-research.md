---
description: Researches and documents modern creative website designs for style specifications and inspiration
argument-hint: <design direction or research topic>
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# Design Research

Research and document modern creative website designs using WebSearch and WebFetch tools. Extracts comprehensive style specifications from award-winning sites, agency portfolios, and design showcases.

Research request: $ARGUMENTS

## When to Use

- Researching design inspiration for a new project
- Creating style guides or design systems
- Analyzing creative website trends
- Documenting aesthetic directions before implementation
- Finding unique typography, color, and motion patterns

## Workflow Overview

```mermaid
flowchart TD
    Define[Define design direction keywords] --> Search[WebSearch: Find inspiration sites]
    Search --> Extract[WebFetch: Pull design details]
    Extract --> Analyze[Analyze patterns]
    Analyze --> Document[Create style document]
    Document --> Save[Save to docs/design/]
```

---

## Phase 1: Define Keywords

Before searching, define your design direction. Be specific about the aesthetic you're targeting.

### Keyword Categories

| Category | Example Keywords |
|----------|------------------|
| **Aesthetic** | brutalist, minimalist, maximalist, editorial, luxury, playful, retro-futuristic |
| **Industry** | agency, portfolio, SaaS, e-commerce, startup, creative studio |
| **Element** | hero section, navigation, footer, pricing, about page, case study |
| **Style** | dark mode, bold typography, kinetic, animated, monochrome, vibrant |
| **Award** | Awwwards, FWA, CSS Design Awards, Webby, site of the day |

### Keyword Combination Template

```
"[aesthetic] + [industry] + website + [year]"
"[element] + design + inspiration + [style]"
"Awwwards + [aesthetic] + site of the day"
"best + [industry] + websites + [year]"
```

---

## Phase 2: Search for Inspiration

Use `WebSearch` to discover creative websites.

### Search Patterns

**Find award-winning sites:**
```
WebSearch: "Awwwards site of the day [aesthetic] 2026"
```

**Find specific styles:**
```
WebSearch: "brutalist web design portfolio examples"
```

**Find typography inspiration:**
```
WebSearch: "bold typography website design [industry]"
```

**Find motion/animation:**
```
WebSearch: "animated website scroll effects creative"
```

---

## Phase 3: Extract Design Details

Use `WebFetch` to pull specific design information from found URLs.

### Extract Landing Pages

```
WebFetch:
  url: "https://site1.com"
  prompt: "Extract design style, colors, typography, layout sections, and visual patterns"
```

### Extract with Focus Areas

**Typography focus:**
```
WebFetch:
  url: "https://example.com"
  prompt: "Extract font family, typography hierarchy, headings, body text styles"
```

**Color focus:**
```
WebFetch:
  url: "https://example.com"
  prompt: "Extract color palette, primary colors, accent colors, background colors"
```

**Layout focus:**
```
WebFetch:
  url: "https://example.com"
  prompt: "Extract layout structure, grid system, sections, hero design, navigation, footer"
```

---

## Phase 4: Analyze & Document

Create a comprehensive style document following this structure.

### Style Document Template

```markdown
# [Style Name]

## Summary

[2-3 sentence description of the aesthetic. What makes it distinctive? What feeling does it evoke?]

## Style

[Detailed description of the overall aesthetic. Include references to design movements, inspirations, and key characteristics.]

### Spec

[Technical specification for implementing this style. Be precise with values.]

- **Typography**: [Font pairings, weights, sizes, tracking, line-height]
- **Color Palette**: [All colors with hex values and usage]
- **Borders**: [Border styles, widths, colors]
- **Motion**: [Animation types, durations, easing]
- **Interactions**: [Hover states, click feedback, transitions]

## Layout & Structure

[Overview of the spatial composition and page structure.]

### [Section Name 1]

[Detailed description of the section including positioning, content, and styling.]

### [Section Name 2]

[Continue for each major section...]

## Special Components

### [Component Name]

[Purpose and visual description]

[Detailed implementation spec including sizing, colors, animations, and interactions.]

## Special Notes

MUST: [Critical requirements that define this style]
DO NOT: [Anti-patterns that break the aesthetic]
```

---

## Phase 5: Save Documentation

Save completed style documents to `docs/design/[style-name].md`.

### File Naming

- Use lowercase with hyphens: `kinetic-orange.md`, `swiss-minimal.md`
- Include date if research is time-sensitive: `brutalist-trends-2026.md`

### Documentation Structure

```
docs/
  design/
    [style-name].md         # Individual style documents
    research-log.md         # Optional: Log of research sessions
    inspiration-sources.md  # Optional: Curated list of sites
```

---

## Complete Example

### Research Goal
Find bold, kinetic typography styles for a portfolio site.

### Step 1: Search
```
WebSearch: "Awwwards kinetic typography portfolio 2026"
```

### Step 2: Extract from top results
```
WebFetch:
  url: "https://example-agency.com"
  prompt: "Extract typography, animation styles, colors, layout, hero section design"
```

### Step 3: Analyze patterns
- Font: Heavy display fonts (Archivo Black, Bebas Neue)
- Color: High contrast (orange/black, white accents)
- Motion: Marquee text, rotating elements
- Layout: Full-width sections, skewed dividers

### Step 4: Create style document
Save to `docs/design/kinetic-orange.md` using the template above.

---

## Quick Reference

### Tools

| Tool | Use For |
|------|---------|
| `WebSearch` | Discover sites, find trends |
| `WebFetch` | Pull detailed content from URLs |

### Output Locations

| Document | Location |
|----------|----------|
| Style specs | `docs/design/[style-name].md` |
| Research logs | `docs/design/research-log.md` |
| Inspiration lists | `docs/design/inspiration-sources.md` |
