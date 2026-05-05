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

When the user asks for a deck / slides / presentation. Each slide is a direct child `<section>` of a `<Deck>` host component. Keyboard nav, slide counter, and print mode are handled by the host (see `references/template.jsx`).

## Workflow

1. **Ask the user**: how many slides, what story, any brand. If they say "I don't know" — propose a 5-7 slide outline and confirm.
2. **`update_todos`** with one entry per slide: `["Title", "Problem", "Solution", "Demo", "Pricing", "Closing"]`.
3. **Write a separate file per slide** if slides have unique layouts (e.g. `Slide01_Title.jsx`, `Slide02_Problem.jsx`, ...) — or inline all in `App.jsx` for short decks (< 7 slides).
4. **Apply `data-screen-label="01 Title"`, `02 Problem`, ...** to each slide root so comment context (`<mentioned-element>` blocks) can identify which slide a user is talking about. Slide numbers are 1-indexed.
5. **Use the `Deck` host** (copy `references/template.jsx` into your project as `deck.jsx`, load it before your app script).
6. **Type & color**: pick a typographic system + 2-3 colors. Do not default to "every slide a different gradient". Decks are most readable when slides share a strong visual system.
7. **Slide-level layout**: real slides have visual hierarchy: title → supporting body → optional accent. Don't center every block. Vary alignment.
8. **Call `done`** when the deck is complete.

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

## Anti-slop for decks

- Don't add a "thank you" slide as the closing slide — closing should restate the ask.
- Don't put 8 bullet points per slide. Aim for 3 max; speaker notes hold the rest.
- Don't use stock-feeling clipart icons throughout.
