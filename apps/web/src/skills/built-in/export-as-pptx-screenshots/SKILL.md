---
name: Export as PPTX (screenshots)
description: Flat images of every slide — pixel-perfect but not editable. Use when fidelity matters more than further editing.
trigger:
  keywords: [pptx screenshots, "pixel perfect pptx", "pptx images", "flat pptx", "screenshot pptx", "导出 ppt 截图", "图片版 ppt"]
od:
  mode: deck
  preview:
    type: jsx
    entry: App.jsx
references: []
---

# Export as PPTX (screenshots)

When the user wants the deck as a .pptx but **doesn't need to edit it further** — they want each slide to look 1:1 with the live preview, including gradients, animations frozen at a specific moment, custom fonts, SVG charts, etc. Each slide becomes a single full-bleed PNG inside the PPTX.

Trade-off vs the `Export as PPTX (editable)` sibling skill:

| | Editable | Screenshots |
|--|---------|-------------|
| Native text editable in PowerPoint | ✅ | ❌ (flat image) |
| Gradients / web fonts preserved | ❌ | ✅ |
| File size | Small (KB) | Large (MB) |
| Accessibility (screen readers) | ✅ | ❌ |
| Use case | Hand off for further editing | Send to a client who just opens it |

## Workflow

1. **Confirm the deck is in the preview**. The preview iframe must currently be showing the deck — that's where we capture from.
2. **Set the slide size** if the deck is non-default. Default is 1920×1080. Read `width` / `height` from the deck's `<Deck>` host or the slide root if visible.
3. **Capture each slide as a screenshot**. For each `<section data-screen-label>` in slide order:
   a. Navigate / scroll the deck to that slide
   b. Call `screenshot_user_view` (main agent) or `screenshot` (verifier) with the selector `[data-screen-label="01 Title"]` — capture as PNG
   c. Store the data URI under `slides[i].image`
4. **Pull speaker notes** from `<script type="application/json" id="speaker-notes">` and attach as `slides[i].notes`.
5. **Call `gen_pptx`** with `mode: 'screenshots'`, the slides array, the right `width` / `height`. The tool fits each image full-bleed to slide dimensions and triggers a download.

## Capture details that matter

- **DPR**: capture at the deck's intrinsic CSS pixel dimensions, not `window.devicePixelRatio` scaled — the PPTX will rasterize at PowerPoint's slide pixel grid anyway, oversampling just bloats the file.
- **Hide host chrome**: any controls / toolbars / slide counter must be `display: none` during capture; the `.no-print` convention from the `Save as PDF` skill works here too.
- **Wait for fonts**: call `document.fonts.ready` (or `await new Promise(r => setTimeout(r, 200))` as a fallback) before screenshotting so custom typography is rendered.
- **Animation freeze**: if the deck has on-load animations, capture AFTER they settle. The screenshot is one frozen moment.

## Done criteria

- One screenshot per slide (slide count matches outline)
- All screenshots have the same width/height
- Speaker notes attached where they exist
- `gen_pptx({mode:'screenshots'})` returned `ok: true`
- Browser download triggered
- Call `done`

## Anti-slop

- Don't capture with the chat panel / Open Design chrome visible
- Don't capture at 4x DPR — file size will balloon and PowerPoint will downsample anyway
- Don't mix editable and screenshots modes in the same export — pick one
- Don't forget speaker notes; the screenshots variant supports them just like the editable variant
- Don't capture mid-animation unless the user explicitly wants a specific frame
