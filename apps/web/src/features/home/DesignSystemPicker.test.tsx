// DesignSystemPicker — interaction unit tests.
//
// Pins the "None is selectable" behaviour so a future MVP-cleanup pass that
// reverts to the old enabled=false won't silently regress: None must be a
// real option in the listbox (not aria-disabled, no "Coming soon" tooltip,
// click + keyboard activate it). Other 3 disabled placeholders
// (claude-style / atelier / material-3) stay aria-disabled — covered too,
// so nobody quietly enables them as part of an unrelated change.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { DesignSystemPicker } from './DesignSystemPicker';

afterEach(() => {
  cleanup();
});

function mount(value: string, onChange: (id: string) => void = () => {}) {
  return render(
    <ThemeProvider theme={theme}>
      <DesignSystemPicker value={value} onChange={onChange} />
    </ThemeProvider>,
  );
}

describe('DesignSystemPicker', () => {
  it('opens the listbox when the trigger is clicked', () => {
    mount('open-design-default');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('renders the None option as enabled and selectable', () => {
    mount('open-design-default');
    fireEvent.click(screen.getByRole('button'));

    const noneOption = screen.getByRole('option', { name: /None/i });
    expect(noneOption).toBeInTheDocument();
    // Critical: NOT aria-disabled — None is a real, pickable option.
    expect(noneOption).toHaveAttribute('aria-disabled', 'false');
    // No "Coming soon" tooltip on the None row.
    expect(noneOption).not.toHaveAttribute('title', 'Coming soon');
    // Keyboard reachable.
    expect(noneOption).toHaveAttribute('tabindex', '0');
  });

  it('keeps the other placeholder design systems aria-disabled', () => {
    mount('open-design-default');
    fireEvent.click(screen.getByRole('button'));
    for (const label of [/Claude/, /Atelier/, /Material 3/]) {
      const opt = screen.getByRole('option', { name: label });
      expect(opt).toHaveAttribute('aria-disabled', 'true');
      expect(opt).toHaveAttribute('title', 'Coming soon');
      // Disabled rows must not be in the tab sequence.
      expect(opt).toHaveAttribute('tabindex', '-1');
    }
  });

  it('fires onChange("none") and closes the menu when None is clicked', () => {
    const onChange = vi.fn();
    mount('open-design-default', onChange);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(screen.getByRole('option', { name: /None/i }));
    expect(onChange).toHaveBeenCalledWith('none');
    // Menu closes after pick.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects None via Enter key (a11y: keyboard-only path)', () => {
    const onChange = vi.fn();
    mount('open-design-default', onChange);
    fireEvent.click(screen.getByRole('button'));

    const noneOption = screen.getByRole('option', { name: /None/i });
    fireEvent.keyDown(noneOption, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('none');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects None via Space key (a11y: keyboard-only path)', () => {
    const onChange = vi.fn();
    mount('open-design-default', onChange);
    fireEvent.click(screen.getByRole('button'));

    const noneOption = screen.getByRole('option', { name: /None/i });
    fireEvent.keyDown(noneOption, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('does NOT fire onChange for disabled options on click', () => {
    const onChange = vi.fn();
    mount('open-design-default', onChange);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(screen.getByRole('option', { name: /Claude/i }));
    expect(onChange).not.toHaveBeenCalled();
    // Listbox stays open since the click was a no-op.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('does NOT fire onChange for disabled options on Enter keypress', () => {
    const onChange = vi.fn();
    mount('open-design-default', onChange);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.keyDown(screen.getByRole('option', { name: /Atelier/i }), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reflects the selected value in the trigger label and aria-selected', () => {
    mount('none');
    // Trigger label flips to None.
    expect(screen.getByRole('button')).toHaveTextContent('None');
    // Open listbox and check aria-selected lives on the None row.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: /None/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Open Design Default/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it("uses the 'free style' sub-label hint when None is selected", () => {
    const { container } = mount('none');
    // The Sub line lives under TextCol in the trigger; just check the
    // string is present in the trigger's text content.
    expect(container.textContent).toContain('free style');
    expect(container.textContent).not.toContain('default');
  });

  it("uses the 'default' sub-label hint for open-design-default", () => {
    const { container } = mount('open-design-default');
    expect(container.textContent).toContain('default');
    expect(container.textContent).not.toContain('free style');
  });
});
