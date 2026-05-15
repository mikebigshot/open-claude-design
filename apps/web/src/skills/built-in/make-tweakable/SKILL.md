---
name: Make tweakable
description: Add in-design tweak controls so the user can adjust copy, colors, sizes and other tokens directly in the preview without re-prompting.
trigger:
  keywords: [tweak, tweakable, controls, editable, knobs, parameters, tunable, "可调", "调节", "微调"]
od:
  mode: design
  preview:
    type: jsx
    entry: App.jsx
references: []
---

# Make tweakable

When the user wants the preview to expose **in-design controls** so they can adjust copy, color tokens, spacing, sizes — without going back to chat. This skill turns the artifact itself into the editing surface.

## Workflow

1. Identify the **tokens worth exposing**. Don't expose every prop — pick ones the user obviously wants to tune (hero headline, primary color, hero image, density). Aim for **3-8 tweaks** per surface.
2. Group tweaks by **scope** (e.g. `hero`, `pricing`, `theme`) so the controls panel reads like the design itself.
3. Embed an `EDITMODE` block at the top of the artifact:

   ```jsx
   /*EDITMODE-BEGIN*/
   {
     "groups": [
       {
         "id": "hero",
         "label": "Hero",
         "controls": [
           { "type": "text",  "key": "hero.title",   "label": "Headline" },
           { "type": "text",  "key": "hero.subtitle","label": "Subtitle" },
           { "type": "color", "key": "theme.primary","label": "Primary color" }
         ]
       }
     ]
   }
   /*EDITMODE-END*/
   ```

4. Reference each tweak key in the JSX via the host-provided `tweaks` proxy (`tweaks.hero.title`, `tweaks.theme.primary`, etc.). Provide a **sensible default** so the artifact still renders before the user opens the controls panel.
5. **Do not** ship more than one EDITMODE block per file. If you need cross-file tweaks, place the single block in the entry file and pull values from a shared module.

## Control types

| `type` | Renders | Notes |
|--------|---------|-------|
| `text` | single-line input | use for copy ≤ 80 chars |
| `textarea` | multi-line input | use for body copy |
| `color` | swatch + picker | values are CSS color strings |
| `number` | numeric input (with min/max/step) | use for size/density tokens |
| `select` | dropdown (provide `options[]`) | use for variants |
| `boolean` | toggle | use for visibility flags |
| `image` | image picker | values are URL strings; user can paste a URL or pick from project assets |

## Done criteria

- `EDITMODE-BEGIN`/`END` block is valid JSON and parses on first try
- Every key referenced in the JSX has a matching control AND a default value
- Opening the controls panel in preview shows the expected groups
- Toggling each control mutates the visible preview live (no reload)
- Call `done` once the above are all true

## Anti-slop for tweakable surfaces

- Don't expose internal/transient state (loading flags, animation tickers) as controls
- Don't put every prop behind a control — the panel becomes overwhelming
- Don't use Chinese-only labels for English-context decks; keep labels match the artifact language
- Don't conflict with the user's stated brand — if they gave a color palette, those become defaults, not optional knobs
