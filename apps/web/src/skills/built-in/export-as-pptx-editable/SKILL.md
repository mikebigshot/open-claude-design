---
name: Export as PPTX (editable)
description: Native text, shapes, and images — editable in PowerPoint / Keynote / Google Slides.
trigger:
  keywords: [pptx, "power point", powerpoint, keynote, "google slides", "export pptx", "editable pptx", "导出 ppt", "导出 pptx", "可编辑 ppt"]
od:
  mode: deck
  preview:
    type: jsx
    entry: App.jsx
references: []
---

# Export as PPTX (editable)

When the user wants their deck as a **.pptx file they can keep editing** in PowerPoint, Keynote, or Google Slides. The output has native PowerPoint shapes / text boxes / images (NOT flat screenshots — that's the sibling skill `Export as PPTX (screenshots)`).

This skill **only** runs after the deck is built. The `Make a deck` skill is the producer; this one is the serializer.

## Workflow

1. **Read the deck**. Find the entry file (typically `App.jsx`) and identify each slide. The `Make a deck` skill stores them as direct children of `<Deck>` with `data-screen-label`.
2. **Translate each slide into a SlideSpec**. SlideSpec is the input shape `gen_pptx` accepts:

   ```ts
   type SlideSpec = {
     title?: string;           // single headline at the top of the slide
     bullets?: string[];       // bullet list (one entry per line)
     images?: Array<{ url: string; x: number; y: number; w: number; h: number; alt?: string }>;
     shapes?: Array<{ kind: 'rect' | 'roundRect' | 'ellipse' | 'line'; x: number; y: number; w: number; h: number; fill?: string; line?: string }>;
     notes?: string;           // speaker notes for this slide
   };
   ```

   Coordinates are in **inches** (PowerPoint native unit). At 1920×1080 px / 96 DPI the slide is 20 × 11.25 inches.

3. **Pull speaker notes** from the `<script type="application/json" id="speaker-notes">` block if present (see `Make a deck`). Map them onto SlideSpec.notes by 2-digit slide index.
4. **Call `gen_pptx`** with `mode: 'editable'`, the slides array, optional `outputFilename`. The tool emits a .pptx file and triggers a browser download.
5. **Confirm to the user** which slides made it across, how many bullet points, whether images are inlined.

## Limitations the user should know about

- **No CSS gradient rendering**: PowerPoint shapes accept solid colors, not CSS gradients. If a slide has gradients, fall back to a single approximate color OR add a note in chat that the gradient will flatten.
- **No web fonts**: the .pptx uses PowerPoint's default font unless the user has the same font installed locally. Sans-serif headlines survive; ornamental display fonts will substitute.
- **Animations don't transfer**: any framer-motion / CSS animation is static in the export.
- **Complex SVG/canvas**: tell the user we render the static visual; interactive bits are lost. If the deck has chart components, suggest the screenshots variant for pixel-perfect fidelity.

## When to choose this vs the screenshots variant

| Want | Use |
|------|-----|
| Edit text after handing off | `Export as PPTX (editable)` (this) |
| Pixel-perfect match to preview | `Export as PPTX (screenshots)` |
| Print to PDF | `Save as PDF` |
| Email a single file | `Save as standalone HTML` |

## Done criteria

- Every slide in the deck has a SlideSpec entry
- Speaker notes attached where they exist
- `gen_pptx` returned `ok: true` with `slideCount` matching what you sent
- Browser download triggered (user sees the system download prompt)
- Call `done`

## Anti-slop for PPTX export

- Don't try to inline screenshots inside an "editable" PPTX — that's what the screenshots variant is for
- Don't omit bullets to fit a layout; if the deck has 7 bullets, send 7 — PowerPoint can scroll
- Don't pretend animations / gradients survived if they didn't — tell the user
- Don't re-design the deck for PPTX export; serialize what's there
