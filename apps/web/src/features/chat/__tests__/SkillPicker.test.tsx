// SkillPicker — submenu shown after the user clicks "Attach skill" in the
// Composer's Add-context popover. Lists all visible built-in skills with
// frontmatter name + description, and fires `onPick(Attachment)` when the
// user clicks one.
//
// Tests use the real skills registry (`@/skills/registry`) — the 4 OSS
// built-ins are deterministic, no need to mock.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { I18nProvider } from '@/i18n';
import { SkillPicker } from '../SkillPicker';
import { SKILLS } from '@/skills/registry';
import { theme } from '@/theme/theme';

function renderPicker(props: Partial<React.ComponentProps<typeof SkillPicker>> = {}): {
  onClose: ReturnType<typeof vi.fn>;
  onPick: ReturnType<typeof vi.fn>;
} {
  const onClose = vi.fn();
  const onPick = vi.fn();
  render(
    <I18nProvider initial="en">
      <ThemeProvider theme={theme}>
        <SkillPicker open onClose={onClose} onPick={onPick} {...props} />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { onClose, onPick };
}

afterEach(() => cleanup());

describe('SkillPicker', () => {
  it('returns null when open=false', () => {
    const { container } = render(
      <I18nProvider initial="en">
        <ThemeProvider theme={theme}>
          <SkillPicker open={false} onClose={() => {}} onPick={() => {}} />
        </ThemeProvider>
      </I18nProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one menuitem per built-in skill (matches SKILLS registry count)', () => {
    // Asserting the live registry size keeps this test from drifting every
    // time we add a v2-aligned skill — 4 → 7 happened in the deck/PPT
    // alignment pass (research/claude-design-v2 §13).
    renderPicker();
    const menu = screen.getByRole('menu', { name: /skill picker/i });
    const items = menu.querySelectorAll('[role="menuitem"]');
    const visibleCount = Object.values(SKILLS).filter(
      (s) => !s.frontmatter.hidden,
    ).length;
    expect(items.length).toBe(visibleCount);
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it('renders skill name + description for each skill', () => {
    renderPicker();
    // Frontend design has a known description.
    expect(screen.getByText('Frontend design')).toBeInTheDocument();
    expect(
      screen.getByText(/Aesthetic direction for designs outside an existing brand system/i),
    ).toBeInTheDocument();
    // Make a deck description
    expect(screen.getByText('Make a deck')).toBeInTheDocument();
    expect(screen.getByText(/Slide presentation in HTML/i)).toBeInTheDocument();
    // Wireframe + Interactive prototype names
    expect(screen.getByText('Wireframe')).toBeInTheDocument();
    expect(screen.getByText('Interactive prototype')).toBeInTheDocument();
  });

  it('clicking a skill calls onPick with a v2 Attachment (id/name/type=skill/content)', () => {
    const { onPick } = renderPicker();
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: /Make a deck/i })));
    expect(onPick).toHaveBeenCalledTimes(1);
    const attachment = onPick.mock.calls[0]![0];
    expect(attachment).toMatchObject({
      name: 'Make a deck',
      type: 'skill',
    });
    expect(typeof attachment.id).toBe('string');
    expect(attachment.id.length).toBeGreaterThan(0);
    expect(typeof attachment.content).toBe('string');
    // body is the SKILL.md content; should be non-trivially long.
    expect(attachment.content.length).toBeGreaterThan(10);
  });

  it('outside-click triggers onClose', () => {
    const { onClose } = renderPicker();
    act(() => fireEvent.mouseDown(document.body));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key triggers onClose', () => {
    const { onClose } = renderPicker();
    act(() => fireEvent.keyDown(document, { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking on the popover itself does not call onClose (mousedown stays inside)', () => {
    const { onClose } = renderPicker();
    const popover = screen.getByRole('menu', { name: /skill picker/i });
    act(() => fireEvent.mouseDown(popover));
    expect(onClose).not.toHaveBeenCalled();
  });
});
