// apps/web/src/skills/built-in/slide-deck/references/template.jsx
//
// Minimal slide deck host. Drop into App.jsx and add <section> children.
// Ships with: keyboard nav (← → space pgup pgdn), slide counter overlay,
// per-slide data-screen-label, postMessage on slide change, print-to-PDF
// hint via @media print.

const Deck = ({ children }) => {
  const slides = React.Children.toArray(children);
  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    const handler = (e) => {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        setIdx((i) => Math.min(i + 1, slides.length - 1));
      } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Home') setIdx(0);
      else if (e.key === 'End') setIdx(slides.length - 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [slides.length]);

  React.useEffect(() => {
    window.parent.postMessage({ slideIndexChanged: idx }, '*');
  }, [idx]);

  return (
    <div className="deck-stage">
      {slides.map((slide, i) => (
        <div
          key={i}
          style={{ display: i === idx ? 'block' : 'none' }}
          data-screen-label={
            slide.props['data-screen-label'] || `${String(i + 1).padStart(2, '0')}`
          }
        >
          {slide}
        </div>
      ))}
      <div
        className="slide-counter"
        style={{
          position: 'fixed',
          bottom: 16,
          right: 24,
          opacity: 0.6,
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        {idx + 1}/{slides.length}
      </div>
      <style>{`
        @media print {
          .slide-counter { display: none; }
          .deck-stage > div { display: block !important; page-break-after: always; }
        }
      `}</style>
    </div>
  );
};

window.Deck = Deck;
