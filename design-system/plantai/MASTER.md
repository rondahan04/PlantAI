# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** PlantAI
**Generated:** 2026-06-15 13:30:58
**Category:** Plant Care Tracker

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E4034` | `--color-primary` |
| On Primary | `#FDFBF7` | `--color-on-primary` |
| Secondary | `#3C6B54` | `--color-secondary` |
| Accent/CTA | `#D2653A` | `--color-accent` |
| Background | `#F7F1E7` | `--color-background` |
| Surface | `#FFFDF9` | `--color-surface` |
| Foreground | `#1B2B22` | `--color-foreground` |
| Muted | `#F0E8DA` | `--color-muted` |
| Border | `#E8DECE` | `--color-border` |
| Destructive | `#B23A20` | `--color-destructive` |
| Ring | `#1E4034` | `--color-ring` |

**Color Notes:** Warm Editorial - cream paper canvas, deep forest green as the
brand voice, terracotta as the single hot accent. One terracotta element per
screen, no blue anywhere: the three care kinds are terracotta (water), clay
brown (repot) and olive (feed).

The React Native app's tokens in `src/theme/index.ts` are the source of truth;
this table mirrors them.

### Typography

- **Heading Font:** Playfair Display (600, 700)
- **Body Font:** Nunito (400, 500, 600)
- **Mood:** editorial, warm, calm, natural, considered
- **Google Fonts:** [Playfair Display + Nunito](https://fonts.google.com/share?selection.family=Playfair+Display:wght@600;700|Nunito:wght@400;500;600)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Nunito:wght@400;500;600&display=swap');
```

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #D2653A;
  color: white;
  padding: 12px 24px;
  border-radius: 999px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E4034;
  border: 2px solid #1E4034;
  padding: 12px 24px;
  border-radius: 999px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFDF9;
  border-radius: 24px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E8DECE;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E4034;
  outline: none;
  box-shadow: 0 0 0 3px #1E403420;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Organic Biophilic

**Keywords:** Nature, organic shapes, green, sustainable, rounded, flowing, wellness, earthy, natural textures

**Best For:** Wellness apps, sustainability brands, eco products, health apps, meditation, organic food brands

**Key Effects:** Rounded corners (16-24px), organic curves (border-radius variations), natural shadows, flowing SVG shapes

### Page Pattern

**Pattern Name:** App Store Style Landing

- **Conversion Strategy:** Show real screenshots. Include ratings (4.5+ stars). QR code for mobile. Platform-specific CTAs.
- **CTA Placement:** Download buttons prominent (App Store + Play Store) throughout
- **Section Order:** 1. Hero with device mockup, 2. Screenshots carousel, 3. Features with icons, 4. Reviews/ratings, 5. Download CTAs

---

## Anti-Patterns (Do NOT Use)

- ❌ Inconsistent styling
- ❌ Poor contrast ratios

### Additional Forbidden Patterns

- ❌ **Emojis as icons** - Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** - All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** - Avoid scale transforms that shift layout
- ❌ **Low contrast text** - Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** - Always use transitions (150-300ms)
- ❌ **Invisible focus states** - Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
