# Search Query Strategies

Detailed keyword strategies and search patterns for design research with Tavily.

---

## Aesthetic-Based Searches

### Brutalist / Raw

```
tavily_search:
  query: "brutalist web design examples 2026"
  max_results: 10
  search_depth: "advanced"
  include_images: true
```

Keywords: brutalist, raw, industrial, utilitarian, anti-design, exposed grid, harsh typography

### Minimalist / Swiss

```
tavily_search:
  query: "minimal swiss design website inspiration"
  max_results: 10
  include_images: true
```

Keywords: minimal, swiss, clean, whitespace, grid-based, typographic, restrained

### Maximalist / Eclectic

```
tavily_search:
  query: "maximalist web design vibrant colors 2026"
  max_results: 10
  include_images: true
```

Keywords: maximalist, eclectic, vibrant, bold, layered, chaotic, collage

### Editorial / Magazine

```
tavily_search:
  query: "editorial web design magazine layout"
  max_results: 10
  include_images: true
```

Keywords: editorial, magazine, columns, pull quotes, feature, longform, article

### Luxury / Premium

```
tavily_search:
  query: "luxury brand website design premium"
  max_results: 10
  include_images: true
```

Keywords: luxury, premium, elegant, refined, sophisticated, high-end, exclusive

### Retro-Futuristic

```
tavily_search:
  query: "retro futuristic web design y2k aesthetic"
  max_results: 10
  include_images: true
```

Keywords: retro-futuristic, y2k, cyber, neo, chrome, holographic, gradient

---

## Element-Focused Searches

### Hero Sections

```
tavily_search:
  query: "creative hero section design [aesthetic] website"
  max_results: 10
  include_images: true
```

Focus: large typography, video backgrounds, animated text, scroll triggers

### Navigation

```
tavily_search:
  query: "creative navigation menu design website"
  max_results: 10
  include_images: true
```

Focus: hamburger alternatives, overlay menus, pill navigation, sticky headers

### Footers

```
tavily_search:
  query: "creative footer design website examples"
  max_results: 10
  include_images: true
```

Focus: mega footers, animated footers, contact CTAs, sitemap integration

### About Pages

```
tavily_search:
  query: "creative about page design agency portfolio"
  max_results: 10
  include_images: true
```

Focus: team sections, timeline, values, mission statements

### Case Studies

```
tavily_search:
  query: "case study page design portfolio"
  max_results: 10
  include_images: true
```

Focus: project grids, before/after, metrics, testimonials

---

## Award Site Searches

### Awwwards

```
tavily_search:
  query: "Awwwards site of the day [keyword] 2026"
  max_results: 10
  search_depth: "advanced"

tavily_search:
  query: "Awwwards honorable mention [industry]"
  max_results: 10
```

### FWA (Favourite Website Awards)

```
tavily_search:
  query: "FWA award winning website [aesthetic]"
  max_results: 10
```

### CSS Design Awards

```
tavily_search:
  query: "CSS Design Awards website of the day"
  max_results: 10
```

---

## Industry-Specific Searches

### Agency / Studio

```
tavily_search:
  query: "creative agency website design portfolio 2026"
  max_results: 10
  include_images: true
```

### Portfolio / Personal

```
tavily_search:
  query: "designer portfolio website creative personal"
  max_results: 10
  include_images: true
```

### SaaS / Product

```
tavily_search:
  query: "SaaS website design modern product landing"
  max_results: 10
  include_images: true
```

### E-commerce

```
tavily_search:
  query: "creative e-commerce website design luxury"
  max_results: 10
  include_images: true
```

---

## Typography Searches

### Bold / Display

```
tavily_search:
  query: "bold typography website design large headings"
  max_results: 10
  include_images: true
```

### Kinetic / Animated

```
tavily_search:
  query: "kinetic typography website animation text"
  max_results: 10
  include_images: true
```

### Serif / Editorial

```
tavily_search:
  query: "serif typography website design editorial"
  max_results: 10
  include_images: true
```

### Variable Fonts

```
tavily_search:
  query: "variable font website design animation"
  max_results: 10
  include_images: true
```

---

## Motion & Animation Searches

### Scroll-Based

```
tavily_search:
  query: "scroll animation website design parallax"
  max_results: 10
  include_images: true
```

### Page Transitions

```
tavily_search:
  query: "page transition animation website smooth"
  max_results: 10
```

### Micro-Interactions

```
tavily_search:
  query: "micro interaction design website hover effects"
  max_results: 10
```

### 3D / WebGL

```
tavily_search:
  query: "3D website design WebGL three.js"
  max_results: 10
```

---

## Color-Focused Searches

### Dark Mode

```
tavily_search:
  query: "dark mode website design creative"
  max_results: 10
  include_images: true
```

### Monochrome

```
tavily_search:
  query: "monochrome website design black white"
  max_results: 10
  include_images: true
```

### Vibrant / Bold Colors

```
tavily_search:
  query: "vibrant color website design bold palette"
  max_results: 10
  include_images: true
```

### Gradient

```
tavily_search:
  query: "gradient mesh website design colorful"
  max_results: 10
  include_images: true
```

---

## Combination Strategies

### High-Impact Combinations

```
"[award] + [aesthetic] + [year]"
"Awwwards brutalist 2026"

"[element] + [style] + inspiration"
"hero section kinetic typography inspiration"

"[industry] + [aesthetic] + website + design"
"creative agency minimalist website design"

"best + [element] + design + [year]"
"best footer design 2026"
```

### Refined Searches

```
"[specific font] + website + design"
"Archivo Black website design"

"[specific color] + [aesthetic] + website"
"orange brutalist website"

"[technique] + website + [industry]"
"marquee text website portfolio"
```

---

## Tips for Effective Searching

1. **Start broad, then refine** - Begin with aesthetic keywords, narrow with elements
2. **Include year** - Add "2026" to find current trends
3. **Use award sites** - Awwwards, FWA, CSS Design Awards curate quality
4. **Combine keywords** - "brutalist + kinetic + portfolio" yields specific results
5. **Check image results** - `include_images: true` captures visual references
6. **Use advanced depth** - Gets more complete results for creative sites
7. **Search multiple sources** - Don't rely on single search; cross-reference
