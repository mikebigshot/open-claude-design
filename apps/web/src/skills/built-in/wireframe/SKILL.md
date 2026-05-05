---
name: Wireframe
description: Explore many ideas with wireframes and storyboards
trigger:
  keywords: [wireframe, sketch, lo-fi, storyboard, 线框, 草图]
od:
  mode: wireframe
  fidelity_default: wireframe
  preview:
    type: jsx
    entry: App.jsx
---

# Wireframe

Wireframes prioritize layout and information over visual detail. Use this skill when the user explicitly asks for a wireframe, sketch, storyboard, or "low fidelity".

## Workflow

1. **Confirm intent**: "Wireframe means grayscale + placeholder content + no decorative styling. Confirm?" One sentence — then proceed if yes or use full design otherwise.
2. **One file per screen, OR a single multi-screen file** with sections. Use `update_todos` to enumerate screens.
3. **Per screen**: render a labeled box for each component. Label inside the box (e.g. `[Hero — headline + CTA]`, `[Pricing card]`). No real images — use grey rectangles with width/height labels. No real copy — use placeholder text patterns: `Lorem · brief · 6 words`. No shadows, no gradients, no rounded corners beyond 4px.
4. **Color palette**: white background, grey-200 borders, grey-700 text. That's it.
5. **Typography**: one sans family (Inter is fine), one size for body (14px), one for labels (11px).
6. **Layout**: real grid alignment matters even at low fidelity. Use Tailwind's `grid` utilities; show alignment.
7. **Call `done`** when the screen is complete.

## Anti-slop for wireframes

- Don't use color (even brand color) — it implies design decisions you haven't made.
- Don't add icon graphics — use a labeled box.
- Don't add real product copy — use generic placeholders.
- Don't make it pretty. The whole point is to commit ideas to layout cheaply.
