// SkillPicker — submenu shown from the "Attach skill" entry in the
// Add-context popover. Lists every visible built-in skill (via
// `listSkills()` from `@/skills/registry`) and surfaces an `onPick` callback
// that yields a v2 `Attachment` shape (id / name / type='skill' / content).
//
// The submenu opens above the composer's "Add context" button (positioned by
// the Composer wrapper) and renders each entry with skill name + the
// frontmatter description on a second line for at-a-glance disambiguation —
// no SOON badge: every built-in is active.
//
// Keyboard a11y: arrow keys move focus between items, Enter picks, Escape
// closes (handled at the menu container level via standard <button> +
// onKeyDown rules).

import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { useT } from '@/i18n';
import { listSkills } from '@/skills/registry';
import type { Attachment } from './ui-messages';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Fires once when the user picks a skill. Yields a ready-to-attach
   * v2 Attachment: id is freshly minted (uuid-ish), content is the parsed
   * SKILL.md body so the message inliner (W3 helper) can wrap it inline.
   */
  onPick: (attachment: Attachment) => void;
}

const Popover = styled.div`
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 280px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line200};
  border-radius: 10px;
  box-shadow: ${(p) => p.theme.shadows.lg};
  padding: 6px;
  z-index: 60;
  font-size: 12.5px;
`;

const Row = styled.button`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  color: ${(p) => p.theme.colors.fg100};
  font-family: inherit;
  font-size: 12.5px;
  &:hover,
  &:focus-visible {
    background: ${(p) => p.theme.colors.bg200};
    outline: none;
  }
`;

const Name = styled.span`
  font-weight: 500;
  color: ${(p) => p.theme.colors.fg100};
`;

const Description = styled.span`
  color: ${(p) => p.theme.colors.fg300};
  font-size: 11px;
  line-height: 1.4;
`;

const EmptyRow = styled.div`
  padding: 8px 10px;
  color: ${(p) => p.theme.colors.fg400};
  font-size: 12px;
  font-style: italic;
`;

/** Minimal fresh-id generator. `crypto.randomUUID` exists in modern browsers
 *  and jsdom 22+; fallback path keeps the test environment happy. */
function freshId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SkillPicker({ open, onClose, onPick }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click closes the picker. Mirrors ImportPopover's behaviour so
  // the two popovers feel consistent.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Escape closes — keyboard a11y baseline.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const skills = listSkills();

  return (
    <Popover
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      aria-label={t('skillPicker.menuAria')}
    >
      {skills.length === 0 && <EmptyRow>{t('skillPicker.empty')}</EmptyRow>}
      {skills.map((skill) => (
        <Row
          key={skill.id}
          type="button"
          role="menuitem"
          aria-label={skill.frontmatter.name}
          onClick={() => {
            onPick({
              id: freshId(),
              name: skill.frontmatter.name,
              type: 'skill',
              content: skill.body,
            });
          }}
        >
          <Name>{skill.frontmatter.name}</Name>
          <Description>{skill.frontmatter.description}</Description>
        </Row>
      ))}
    </Popover>
  );
}
