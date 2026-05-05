// DrawOverlay — parent-side SVG overlay for the Draw mode.
//
// Captures pointer events on top of the iframe (via pointer-events: auto
// when active), converts them to local-coordinate strokes, and forwards
// them to the workspace state.
//
// Two sub-modes:
//   - `draw`: pointer-down → pointer-move samples → pointer-up
//     creates a polyline of points.
//   - `click`: each pointer-down deposits a single circle annotation.
//
// `voice` sub-mode is wired in DrawDock as disabled.

import { useRef } from 'react';
import styled from 'styled-components';
import type { ClickAnnotation, DrawShape, DrawStroke, DrawSubMode } from '@/state/types';

export interface DrawOverlayProps {
  active: boolean;
  subMode: DrawSubMode;
  strokes: DrawShape[];
  drawing: DrawStroke | null;
  onBegin: (stroke: DrawStroke) => void;
  onMove: (point: [number, number]) => void;
  onEnd: () => void;
  onClickAnnotation: (annotation: ClickAnnotation) => void;
}

const Overlay = styled.svg<{ $active: boolean }>`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: ${(p) => (p.$active ? 'auto' : 'none')};
  cursor: ${(p) => (p.$active ? 'crosshair' : 'default')};
  z-index: 15;
`;

const STROKE_COLOR = 'var(--brand-base, #C96442)';

export function DrawOverlay({
  active,
  subMode,
  strokes,
  drawing,
  onBegin,
  onMove,
  onEnd,
  onClickAnnotation,
}: DrawOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  function localPoint(event: React.PointerEvent<SVGSVGElement>): [number, number] {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!active) return;
    const [x, y] = localPoint(event);
    if (subMode === 'click') {
      onClickAnnotation({ type: 'click', x, y });
      return;
    }
    if (subMode === 'draw') {
      // capture pointer so move events keep flowing to this svg
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* jsdom test envs may not implement setPointerCapture; ignore */
      }
      onBegin({ type: 'draw', points: [[x, y]] });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!active || !drawing) return;
    if (subMode !== 'draw') return;
    const [x, y] = localPoint(event);
    onMove([x, y]);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!active || !drawing) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* fine */
    }
    onEnd();
  };

  return (
    <Overlay
      ref={svgRef}
      data-testid="draw-overlay-canvas"
      data-active={active ? 'true' : 'false'}
      data-submode={subMode}
      $active={active}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={(event) => {
        if (drawing) handlePointerUp(event);
      }}
      role="img"
      aria-hidden={!active}
    >
      {strokes.map((shape, idx) => {
        if (shape.type === 'click') {
          return (
            <g key={`click-${idx}`} data-testid="draw-shape-click">
              <circle
                cx={shape.x}
                cy={shape.y}
                r={14}
                fill="none"
                stroke={STROKE_COLOR}
                strokeWidth={2}
              />
              <circle cx={shape.x} cy={shape.y} r={3} fill={STROKE_COLOR} />
            </g>
          );
        }
        return (
          <polyline
            key={`stroke-${idx}`}
            data-testid="draw-shape-stroke"
            points={shape.points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={STROKE_COLOR}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      {drawing ? (
        <polyline
          data-testid="draw-shape-drawing"
          points={drawing.points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={STROKE_COLOR}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </Overlay>
  );
}
