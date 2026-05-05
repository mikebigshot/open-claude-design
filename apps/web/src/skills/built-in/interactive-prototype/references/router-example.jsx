// apps/web/src/skills/built-in/interactive-prototype/references/router-example.jsx
//
// Minimal multi-screen state machine using URL hash. Drop in as router.jsx,
// then your screens are React components that read `screen` and call `goto`.

const useScreen = (initial = 'home') => {
  const [screen, setScreen] = React.useState(() => window.location.hash.slice(1) || initial);
  React.useEffect(() => {
    const onHash = () => setScreen(window.location.hash.slice(1) || initial);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [initial]);
  const goto = (next) => {
    window.location.hash = next;
  };
  return [screen, goto];
};

window.useScreen = useScreen;
