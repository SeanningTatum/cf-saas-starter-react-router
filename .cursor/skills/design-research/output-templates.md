# Output Templates

Complete examples and templates for documenting design research.

---

## Full Style Document Example

This is the complete output format for a researched design style.

```markdown
# Kinetic Orange

## Summary

The 'Kinetic Orange' style is a digital-first brutalist aesthetic that uses heavy typography and motion to create a sense of urgency and technical sophistication. It relies on a three-color system (Orange, Black, White) and sharp geometric layouts.

## Style

High-impact brutalist theme. It pairs the heavy weight of 'Archivo Black' for display text with the technical precision of 'Space Mono' for metadata and labels. The primary color is a vibrant electric orange (#FF4D00). Visuals are defined by thick borders (2px+), skewed sections, and continuous marquee animations.

### Spec

Create a design with a primary background color of #FF4D00 and deep black #000000 text. 
- **Typography**: Headers in 'Archivo Black', uppercase, tracking -0.04em, line-height 0.85-0.9. Metadata and UI labels in 'Space Mono', tracking -0.02em. Body text in 'Inter'. 
- **Color Palette**: Brand Orange (#FF4D00), Solid Black (#000000), and Pure White (#FFFFFF) for high-contrast accents on black backgrounds. 
- **Borders**: 2px solid #000000 for section dividers and buttons. 
- **Motion**: Use linear marquees for text-heavy sections. Implement a 'spin' animation for circular indicators (12s duration). 
- **Interactions**: Hover states should include horizontal translations (translate-x-4) and scale transforms (scale-110). Selection color should be background: black; color: #FF4D00;

## Layout & Structure

A vertically stacked layout with full-width sections. It uses a floating 'pill' navigation bar and incorporates skewed transitions between sections to break the grid.

### Floating Navigation

A fixed top navigation with a logo on the left and social icons on the right. In the center, a floating black 'pill' container (background #000000, rounded-full) housing links in white 'Space Mono' (size 12px). Links should transition to black text on white background on hover.

### Typographic Hero Section

A fullscreen header with the main headline centered in 'Archivo Black' at 16vw size. Below the headline, a 2px black horizontal border separates the hero from a metadata row containing a 'Based in...' label (left), a rotating circular 'Scroll Down' text indicator (center), and a multi-line title/role (right).

### Skewed Marquee Section

A full-width section with background #000000, skewed at -2deg. Contains two rows of infinite scrolling text. Row 1: Orange text (#FF4D00) in Archivo Black, 10vw size. Row 2: White text with 80% opacity, scrolling in reverse.

### Vertical Service List

A dark section (background #000000, text #FFFFFF). Items are separated by 1px white/20% borders. Each item features a leading number in #FF4D00 (Space Mono), a large uppercase title (Archivo Black, 7vw), and a row of pill-shaped tags. On hover, the title moves right and a large #FF4D00 arrow icon reveals at 45 degrees.

### Giant CTA and Footer

A centered CTA with 14vw heading. A large rounded-full button (#000000 background, white text) that scales up on hover. Footer is separated by a 2px black top border, containing copyright info and horizontal social links in Space Mono (12px).

## Special Components

### Rotating Scroll Indicator

A circular SVG path with text that rotates infinitely.

Create a 144px diameter circle. Inside, use an SVG <textPath> on a circular path to repeat the string 'Scroll Down • ' 3-4 times. Use font 'Space Mono', size 9px, weight bold, uppercase. Place a static arrow-down icon (Lucide) in the center. Animate the SVG text container with a linear rotation (360deg over 12s).

### Brutalist Service Card

Interactive list item with reveal effects.

A list item spanning 100% width with a top border. Layout: [Index (Orange, Mono)] [Title + Tags (White, Archivo)] [Arrow Icon (Hidden, Orange)]. On hover: Background shifts to white/5% opacity, Title translates +16px horizontally, Arrow opacity becomes 1 and rotates 45deg.

## Special Notes

MUST: Maintain extremely high contrast. MUST: Use only uppercase for Archivo Black headers. MUST: Ensure all borders are sharp (no rounded corners except for pill-shaped buttons and navigation). DO NOT: Use gradients, drop shadows (except for navigation depth), or soft pastels. DO NOT: Use standard sans-serifs for headlines.
```

---

## Blank Template

Copy this template for new style documents.

```markdown
# [Style Name]

## Summary

[2-3 sentences describing the aesthetic, its mood, and key characteristics.]

## Style

[Detailed description of the overall visual direction. Reference design movements, key inspirations.]

### Spec

[Technical implementation spec with precise values.]

- **Typography**: [Fonts, weights, sizes, tracking, line-height]
- **Color Palette**: [All colors with hex and usage]
- **Borders**: [Border styles]
- **Motion**: [Animation specs]
- **Interactions**: [Hover, focus, active states]

## Layout & Structure

[Overview of page composition and spatial organization.]

### [Section 1]

[Detailed spec for this section.]

### [Section 2]

[Detailed spec for this section.]

### [Section 3]

[Detailed spec for this section.]

## Special Components

### [Component 1]

[Purpose]

[Implementation spec]

### [Component 2]

[Purpose]

[Implementation spec]

## Special Notes

MUST: [Critical requirements]
DO NOT: [Anti-patterns to avoid]
```

---

## Quick Style Card Template

For rapid documentation of multiple styles.

```markdown
# [Style Name]

**Aesthetic**: [One-word description]
**Mood**: [2-3 adjectives]
**Best For**: [Use cases]

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| Primary | #XXXXXX | [usage] |
| Secondary | #XXXXXX | [usage] |
| Accent | #XXXXXX | [usage] |
| Background | #XXXXXX | [usage] |

### Typography
| Usage | Font | Weight | Size |
|-------|------|--------|------|
| Display | [font] | [weight] | [size] |
| Body | [font] | [weight] | [size] |
| Mono | [font] | [weight] | [size] |

### Key Elements
- [Element 1]: [Description]
- [Element 2]: [Description]
- [Element 3]: [Description]

### Sources
- [URL 1]
- [URL 2]
```

---

## Research Log Template

Track research sessions over time.

```markdown
# Design Research Log

## [Date]: [Research Focus]

### Goal
[What you were looking for]

### Keywords Used
- [keyword 1]
- [keyword 2]
- [keyword 3]

### Sites Found
| Site | URL | Notable Elements |
|------|-----|------------------|
| [Name] | [URL] | [What stood out] |

### Patterns Observed
1. [Pattern]: [Description]
2. [Pattern]: [Description]

### Saved Assets
- `docs/design/[style-name].md` - [Description]

---

## [Date]: [Research Focus]

[Repeat format...]
```

---

## Inspiration Sources Template

Curate and maintain reference sites.

```markdown
# Design Inspiration Sources

## Award Sites
- [Awwwards](https://awwwards.com) - Site of the Day, Honorable Mentions
- [FWA](https://thefwa.com) - Favourite Website Awards
- [CSS Design Awards](https://cssdesignawards.com)
- [Webby Awards](https://webbyawards.com)

## Curated Collections
- [Godly](https://godly.website) - Curated web design inspiration
- [Siteinspire](https://siteinspire.com) - Showcase of finest web design
- [Land-book](https://land-book.com) - Landing page gallery

## By Aesthetic

### Brutalist
| Site | URL | Notes |
|------|-----|-------|
| [Name] | [URL] | [Notes] |

### Minimalist
| Site | URL | Notes |
|------|-----|-------|
| [Name] | [URL] | [Notes] |

### Editorial
| Site | URL | Notes |
|------|-----|-------|
| [Name] | [URL] | [Notes] |

## By Element

### Hero Sections
- [URL]: [Description]

### Navigation
- [URL]: [Description]

### Typography
- [URL]: [Description]

### Animation
- [URL]: [Description]
```

---

## Section-Specific Templates

### Hero Section Spec

```markdown
### Hero Section: [Name]

**Layout**: [fullscreen / split / centered / asymmetric]
**Background**: [solid / gradient / image / video]

**Headline**:
- Font: [family]
- Size: [vw or px]
- Weight: [weight]
- Color: [hex]
- Animation: [entrance effect]

**Subheadline**:
- Font: [family]
- Size: [px]
- Color: [hex]

**CTA**:
- Style: [button / link / icon]
- Hover: [effect]

**Special Elements**:
- [Element]: [Description]
```

### Navigation Spec

```markdown
### Navigation: [Name]

**Type**: [fixed / sticky / overlay / hidden]
**Position**: [top / bottom / side]

**Logo**:
- Position: [left / center]
- Size: [px]

**Links**:
- Font: [family]
- Size: [px]
- Spacing: [px]
- Hover: [effect]

**Mobile**:
- Trigger: [hamburger / icon / gesture]
- Animation: [slide / fade / expand]
```

### Footer Spec

```markdown
### Footer: [Name]

**Layout**: [columns / centered / split]
**Background**: [color]
**Border**: [top border spec]

**Sections**:
1. [Section]: [Content]
2. [Section]: [Content]

**Typography**:
- Links: [font, size]
- Legal: [font, size]

**Special Elements**:
- [Element]: [Description]
```
