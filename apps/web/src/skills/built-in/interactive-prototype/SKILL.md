---
name: Interactive prototype
description: Working app with real interactions
trigger:
  keywords: [prototype, interactive, click-through, multi-screen, app, 原型]
od:
  mode: prototype
  fidelity_default: high
  preview:
    type: jsx
    entry: App.jsx
references:
  - router-example.jsx
---

# Interactive prototype

When the user wants something they can click through — multiple screens, navigation, state. Use a small state machine; keep it React-only.

## Workflow

1. **Map the screens**: list them with `update_todos`. Even short prototypes benefit from a 3-5 entry todo: `["Home", "Search results", "Detail", "Confirmation"]`.
2. **Choose routing strategy**:
   - **`useState` only** for prototypes < 4 screens with no need to share URL.
   - **URL hash routing** (`#screen-name`) for sharable / refreshable state. Use `references/router-example.jsx` as the starting point.
3. **One file per screen** for screens >= 100 lines; otherwise inline in `App.jsx`.
4. **Persist user input across screens** — use `useState` lifted to `App` or use `localStorage` for state that should survive refresh (block-1 line 47 says: timed playback positions go in localStorage too).
5. **Apply `data-screen-label`** to each screen root for comment context.
6. **Animate transitions sparingly** — CSS transitions are usually enough. Don't pull in framer-motion unless an animation actually requires it.
7. **Call `done`** when the prototype is complete.

## App.jsx skeleton (with hash routing)

```jsx
// load: <script type="text/babel" src="router.jsx"></script>
// then: <script type="text/babel" src="app.jsx"></script>
const App = () => {
  const [screen, goto] = useScreen('home');
  if (screen === 'home') return <Home goto={goto} />;
  if (screen === 'search') return <Search goto={goto} />;
  if (screen === 'detail') return <Detail goto={goto} />;
  return <NotFound goto={goto} />;
};
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
```

## Anti-slop for prototypes

- Don't gate the prototype behind a fake login screen unless login IS the prototype.
- Don't add lorem ipsum content where realistic placeholder content would clarify the interaction.
- Don't put a "Title" screen at the start. Center the actual first screen of the prototype.
