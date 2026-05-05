---
name: Frontend design
description: Aesthetic direction for designs outside an existing brand system
trigger:
  keywords: [landing page, ui, interface, page, app, dashboard, hero, marketing]
od:
  mode: design
  preview:
    type: jsx
    entry: App.jsx
---

# Frontend design

When the user asks for a generic interface (a landing page, a marketing site, a dashboard, an app screen), you have no design system to anchor in. Your job is to make taste choices and own them.

## Workflow

1. **Ask one round of clarifying questions** if the brief is ambiguous: target audience, mood (playful / serious / luxury / utilitarian), primary CTA, content density, dark/light preference. Don't over-question — one round, then build.
2. **Pick a direction and commit**. Examples: "editorial serif + generous whitespace", "neobrutalist with chunky borders", "soft glass UI", "terminal-inspired monospace". Name the direction in your reply so the user can redirect.
3. **Scaffold one HTML file** (e.g. `Landing.html`) with React 18.3.1 + Babel Standalone (versions are pinned — see system prompt). Use Tailwind CDN for utility classes when useful.
4. **Use `update_todos` if the work is multi-screen** (>= 3 distinct sections / pages).
5. **Apply taste discipline**: see § Anti-slop below.
6. **Call `done` when a screen is complete**.

## Anti-slop

These signals correlate with low-craft AI output. Avoid them:

- Generic gradient blobs in the background, especially purple→pink. If you use a gradient, anchor it to brand or content.
- Stock-feeling icon sets used decoratively. Pick one icon family and use sparingly.
- Default Inter at default Tailwind sizes everywhere. Pick a typographic system: pair a display face (e.g. Instrument Serif, Fraunces, Playfair, EB Garamond, Inter Tight, Space Grotesk) with a text face. Set deliberate type scale.
- "Modern SaaS" hero with centered headline + subhead + CTA + screenshot. If you build this, give it a specific point of view (typography, color, density).
- Lazy section spacing (every section `py-24`). Vary section rhythm to convey hierarchy.
- Card grids of 3 with identical content shapes ("Feature 1 / Feature 2 / Feature 3"). Even if there are 3, vary the visual weight.

## When the user provides reference

If the user pastes a URL or screenshot, treat it as the design context. Use `web_fetch` to read text content from a URL; `view_image` for screenshots. Match palette, type, density, and tone — don't slavishly copy layout.

## Tools you'll typically use

`update_todos`, `write_file`, `read_file`, `view_image`, `web_fetch`, `done`.
