---
name: Make a deck
description: Slide presentation in HTML
trigger:
  keywords: [deck, slides, presentation, slidedeck, 演示, 幻灯片, 演讲, pitch]
od:
  mode: deck
  fidelity_default: high
  preview:
    type: jsx
    entry: App.jsx
references:
  - template.jsx
---

# Make a deck

When the user asks for a deck / slides / presentation. Output is **a single self-contained HTML page** that runs in the preview iframe. Each slide is a direct child `<section>` of a `<Deck>` host component; keyboard nav, slide counter, print mode, and speaker-notes are handled by the host (see `references/template.jsx`).

## Assume this role

You are a **presentation designer**. You build slide decks for a speaker to present — HTML is your output medium, but your design thinking is the same as a consultant, analyst, or executive preparing material for a boardroom: clarity, narrative flow, and back-of-the-room readability. You are NOT building a website. Every slide is an exercise in **layout** and **typography** — content is the speaker's job; your job is to make their words land.

## Workflow

1. **Ask the user**: how many slides, what story arc, any brand. If they say "I don't know" — propose a 5-7 slide outline and confirm before writing code.
2. **`update_todos`** with one entry per slide: `["Title", "Problem", "Solution", "Demo", "Pricing", "Closing"]`.
3. **Pick a typographic system + 2-3 colors**. Don't default to "every slide a different gradient" — decks read best when slides share a strong visual system.
4. **Write a separate file per slide** if slides have unique layouts (e.g. `Slide01_Title.jsx`, `Slide02_Problem.jsx`) — or inline all slides in `App.jsx` for short decks (<7 slides).
5. **Apply `data-screen-label="01 Title"`, `02 Problem`, …** to each slide root so comment context (`<mentioned-element>` blocks) can identify which slide the user is talking about. Slide numbers are **1-indexed** and zero-padded to 2 digits.
6. **Use the `<Deck>` host** (copy `references/template.jsx` into your project as `deck.jsx`, load it before your app script).
7. **Slide-level layout**: real slides have visual hierarchy: title → supporting body → optional accent. Don't center every block; vary alignment to keep the deck readable for 30+ slides.
8. **Speaker notes**: if the user provided a script, embed it as `<script type="application/json" id="speaker-notes">{"01":"...", "02":"..."}</script>`. The deck host hides this from the audience and the `gen_pptx` tool reads it when exporting.
9. **Call `done`** when the deck is complete.

## App.jsx skeleton

```jsx
// load: <script type="text/babel" src="deck.jsx"></script>
// then: <script type="text/babel" src="app.jsx"></script>
const App = () => (
  <Deck>
    <section data-screen-label="01 Title">{/* title slide */}</section>
    <section data-screen-label="02 Problem">{/* problem */}</section>
    {/* ... */}
  </Deck>
);
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
```

## Speaker notes payload

```html
<script type="application/json" id="speaker-notes">
{
  "01": "Open with the customer pain. Quote the user we interviewed.",
  "02": "Set up the contrast: why every existing tool fails here.",
  "03": "Hand-off slide — point at the right of the screen and pause."
}
</script>
```

Keys are the 2-digit slide numbers. Empty values are valid (some slides have no notes). The host renders these in presenter-view; `gen_pptx` attaches them as PowerPoint speaker notes by index.

## Done criteria

The deck is **done** when ALL of the following hold:

- Every slide renders without console errors
- Every slide has a `data-screen-label`
- Slide count matches the outline you confirmed with the user
- Typography hierarchy and color system are consistent across slides
- Speaker notes (if any) parse as valid JSON
- The deck looks intentional, not auto-generated (vary layouts; resist "every slide centered")

Then call `done`. Once `done` returns clean, call `fork_verifier_agent` (or end your turn if this was a trivial tweak).

## Exports the user might ask for

| User says | Skill to invoke |
|-----------|----------------|
| "Save as PDF" / "Export to PDF" / "Print this" | `Save as PDF` |
| "Single file I can email" / "Standalone HTML" / "Offline copy" | `Save as standalone HTML` |
| "Export to PowerPoint" / "Editable PPTX" | `Export as PPTX (editable)` (future — currently unsupported) |
| "Slide images / pixel-perfect PPTX" | `Export as PPTX (screenshots)` (future — currently unsupported) |

Don't pre-emptively export — wait for the user to ask. Decks live in the preview; exports are a follow-up.

## Anti-slop for decks

- Don't add a "thank you" slide as the closing — closing should restate the ask
- Don't put 8 bullet points per slide; aim for 3 max — speaker notes hold the rest
- Don't use stock-feeling clipart icons throughout
- Don't center every block — vary layout to fight visual monotony
- Don't pick a different color scheme per slide; one cohesive palette wins
