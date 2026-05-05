// ExamplesTab — gallery of starter prototypes.
//
// Each row is a wide card: 2/3 left = sandboxed iframe loading
// `apps/web/public/examples/<slug>/example.html`, 1/3 right = title +
// description + highlight chips + "Use this prompt" CTA.
//
// "Use this prompt" creates a brand-new project (POST /api/projects) and
// stashes the example prompt in sessionStorage. The Workspace mount effect
// drains it into `workspace.composerSeed` → ChatPanel pre-fills the
// Composer input. The user reviews and submits manually — we deliberately
// DO NOT auto-send. Auto-send would collide with the BYOK gate: KeyModal
// cancel would silently drop the example prompt.
//
// Demo preview interaction: hover-to-activate WITHOUT resizing the box.
// Box height is fixed at 480px. Hover/focus only flips the iframe's
// `pointer-events` from `none` to `auto` so wheel + click events
// reach the demo (scrolling long control panels, exercising animations,
// clicking sample buttons). Same tab can only have one active example at
// a time, so hovering a sibling immediately releases the current one (no
// conflicting captured wheels). Touch / `(hover: none)` devices fall back
// to permanently active (no hover concept). v1 of this fix grew the box
// from 300px → 480px on hover; the layout shift was distracting and
// nothing in the official UI does that, so v2 keeps the height stable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

import type { CreateProjectRequest, Project } from '@open-design/contracts';
import { useT } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { EXAMPLES, type ExampleEntry } from './examples-data';

// ─────────────────────────────────────────────────────────────────────────────
// Styled
// ─────────────────────────────────────────────────────────────────────────────

const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1080px;
  margin: 0 auto;
`;

const Intro = styled.div`
  margin-bottom: 4px;
  color: ${(p) => p.theme.colors.fg400};
  font-size: 12.5px;
  line-height: 1.55;
`;

const Card = styled.article`
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
  padding: 18px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 14px;
  transition:
    border-color 0.16s,
    box-shadow 0.16s;

  &:hover {
    border-color: ${(p) => p.theme.colors.brandSoft};
    box-shadow: 0 1px 0 ${(p) => p.theme.colors.brandSoft};
  }

  @media (max-width: 880px) {
    grid-template-columns: 1fr;
  }
`;

// PreviewBox is a fixed 480px tall regardless of active state. `overflow:
// hidden` clips long demos visually; the actual scroll happens inside the
// iframe's own document, which becomes interactable when `pointer-events:
// auto` flips on (see PreviewFrame below).
const PreviewBox = styled.div`
  position: relative;
  height: 480px;
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 10px;
  overflow: hidden;
  background: #fff;

  &:focus-visible {
    outline: 2px solid ${(p) => p.theme.colors.brandBase};
    outline-offset: 2px;
  }
`;

// `pointer-events` is the actual interaction toggle: when inactive, wheel /
// click events pass through to PreviewBox (so the card hover hint still
// works); when active, the iframe captures them so the user can scroll and
// interact with the demo. ExamplesTab guarantees only one active at a time.
const PreviewFrame = styled.iframe<{ $active: boolean }>`
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: ${(p) => (p.$active ? 'auto' : 'none')};
  background: #fff;

  @media (hover: none) {
    pointer-events: auto;
  }
`;

// Hover hint overlay — only visible on inactive state. Tells users they can
// interact (otherwise it looks like a static screenshot). Auto-hides when
// the mouse moves over the box (which also activates it). On touch (hover:
// none) it's hidden because the preview is always active.
const HoverHint = styled.div`
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10.5px;
  font-family: ${(p) => p.theme.fonts.mono};
  letter-spacing: 0.4px;
  pointer-events: none;
  user-select: none;
  opacity: 0.9;
  transition: opacity 0.14s;

  @media (hover: none) {
    display: none;
  }
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const Title = styled.h3`
  font-family: ${(p) => p.theme.fonts.serif};
  font-size: 22px;
  font-weight: 400;
  margin: 0 0 6px;
  color: ${(p) => p.theme.colors.fg100};
  line-height: 1.2;
`;

const Description = styled.p`
  font-size: 12.5px;
  line-height: 1.55;
  color: ${(p) => p.theme.colors.fg300};
  margin: 0 0 12px;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 14px;
`;

const Chip = styled.span`
  font-size: 10.5px;
  font-family: ${(p) => p.theme.fonts.mono};
  letter-spacing: 0.4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: ${(p) => p.theme.colors.bg200};
  color: ${(p) => p.theme.colors.fg400};
  text-transform: lowercase;
`;

const CTARow = styled.div`
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PrimaryButton = styled.button`
  padding: 9px 14px;
  border-radius: 8px;
  background: ${(p) => p.theme.colors.brandBase};
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 500;
  font-family: inherit;

  &:hover:not(:disabled) {
    background: ${(p) => p.theme.colors.brandHover};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorText = styled.div`
  margin-top: 6px;
  font-size: 11.5px;
  color: ${(p) => p.theme.colors.danger};
`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debounce delay (ms) for hover deactivation. Short enough to feel snappy
 * when the user moves between cards, long enough to not flicker if they
 * briefly skim past the box edge. Cross-card moves (mouseenter on B while
 * A is still in its leave timeout) cancel the timeout and switch atomically.
 */
const DEACTIVATE_DEBOUNCE_MS = 150;

export interface ExamplesTabProps {
  /** Called after the new project is created so the parent can refresh the project list. */
  onProjectCreated?: (project: Project) => void;
}

export function ExamplesTab({ onProjectCreated }: ExamplesTabProps) {
  const t = useT();
  // Single source of truth for which preview is interactive. Keeping this in
  // ExamplesTab (not per-card) guarantees mutual exclusion — at most one
  // example can be active at a time, matching the user's spec.
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const activate = useCallback(
    (slug: string) => {
      cancelLeaveTimer();
      setActiveSlug((prev) => (prev === slug ? prev : slug));
    },
    [cancelLeaveTimer],
  );

  const scheduleDeactivate = useCallback(
    (slug: string) => {
      cancelLeaveTimer();
      leaveTimerRef.current = setTimeout(() => {
        // Guard: only clear if this slug is still active. Avoids stomping a
        // newer activation that came in between scheduling and firing.
        setActiveSlug((prev) => (prev === slug ? null : prev));
        leaveTimerRef.current = null;
      }, DEACTIVATE_DEBOUNCE_MS);
    },
    [cancelLeaveTimer],
  );

  // Cleanup pending timer on unmount so a setState after unmount doesn't fire.
  useEffect(
    () => () => {
      cancelLeaveTimer();
    },
    [cancelLeaveTimer],
  );

  return (
    <Stack>
      <Intro>{t('examples.intro')}</Intro>
      {EXAMPLES.map((entry) => (
        <ExampleCard
          key={entry.slug}
          entry={entry}
          onProjectCreated={onProjectCreated}
          isActive={activeSlug === entry.slug}
          onActivate={() => activate(entry.slug)}
          onDeactivate={() => scheduleDeactivate(entry.slug)}
        />
      ))}
    </Stack>
  );
}

interface ExampleCardProps {
  entry: ExampleEntry;
  onProjectCreated?: (project: Project) => void;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}

function ExampleCard({
  entry,
  onProjectCreated,
  isActive,
  onActivate,
  onDeactivate,
}: ExampleCardProps) {
  const t = useT();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUsePrompt = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const body: CreateProjectRequest = {
        name: entry.title.split('—')[0]?.trim() || entry.title,
        type: entry.projectType,
        fidelity: entry.fidelity,
      };
      const project = await api<Project>('/api/projects', {
        method: 'POST',
        body: body as unknown as BodyInit,
      });
      onProjectCreated?.(project);
      // Stash the example prompt in sessionStorage so the workspace can pick
      // it up on first render — keyed by project id so a stale value from a
      // different project doesn't leak. Workspace reads + clears on mount.
      // Key name `seed-composer` reflects the new semantics (pre-fill the
      // Composer input, not auto-send). The legacy `seed-prompt` key is
      // still drained by Workspace for back-compat with old tabs.
      try {
        sessionStorage.setItem(`open-design:seed-composer:${project.id}`, entry.prompt);
      } catch {
        /* sessionStorage may be disabled (private mode); fallback: no seed */
      }
      navigate(`/p/${project.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <PreviewBox
        onMouseEnter={onActivate}
        onMouseLeave={onDeactivate}
        onFocus={onActivate}
        onBlur={onDeactivate}
        tabIndex={0}
        role="region"
        aria-label={`${entry.title} preview — hover or focus to interact`}
        data-testid={`example-preview-${entry.slug}`}
        data-active={isActive ? 'true' : 'false'}
      >
        <PreviewFrame
          $active={isActive}
          src={entry.previewPath}
          title={`${entry.title} preview`}
          sandbox="allow-scripts"
          loading="lazy"
        />
        {!isActive && <HoverHint>{t('examples.hoverHint')}</HoverHint>}
      </PreviewBox>
      <Body>
        <Title>{entry.title}</Title>
        <Description>{entry.description}</Description>
        <ChipRow>
          {entry.highlights.map((h) => (
            <Chip key={h}>{h}</Chip>
          ))}
        </ChipRow>
        <CTARow>
          <PrimaryButton type="button" onClick={() => void handleUsePrompt()} disabled={creating}>
            {creating ? t('examples.creating') : t('examples.useThisPrompt')}
          </PrimaryButton>
          {error && <ErrorText role="alert">{error}</ErrorText>}
        </CTARow>
      </Body>
    </Card>
  );
}
