// ModelDropdown — multi-provider model picker (controlled + uncontrolled).
//
// Backed by lib/model-pref localStorage with cross-tab + same-tab broadcast
// via lib/model-pref-events. Verifies:
//   - default trigger label
//   - controlled mode + persist round-trip
//   - menu open/close + outside click close
//   - per-provider grouping + "no key" disable on missing BYOK
//   - cross-tab subscribe path
//   - persistModel/loadStoredModel exports

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { ModelDropdown, loadStoredModel, persistModel } from '../ModelDropdown';
import { theme } from '@/theme/theme';
import { emitModelChange } from '@/lib/model-pref-events';
import { setModelPref } from '@/lib/model-pref';
import { byokKey } from '@/lib/byok-key';
import { DEFAULT_MODEL_ID, MODELS } from '@open-design/contracts';

function renderWithTheme(ui: React.ReactElement): void {
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
}

beforeEach(() => {
  // Reset localStorage so each test starts fresh.
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ModelDropdown', () => {
  it('renders the default model label when storage is empty', () => {
    renderWithTheme(<ModelDropdown />);
    const trigger = screen.getByTestId('model-dropdown-trigger');
    // DEFAULT_MODEL_ID = anthropic/claude-sonnet-4-6 → label "Sonnet 4.6"
    expect(trigger.textContent).toContain('Sonnet 4.6');
  });

  it('renders the persisted model label after a setModelPref call', () => {
    setModelPref({ provider: 'openrouter', modelId: 'anthropic/claude-opus-4-7' });
    renderWithTheme(<ModelDropdown />);
    expect(screen.getByTestId('model-dropdown-trigger').textContent).toContain('Opus 4.7');
  });

  it('uses the controlled `model` prop over localStorage', () => {
    setModelPref({ provider: 'openrouter', modelId: 'anthropic/claude-opus-4-7' });
    renderWithTheme(<ModelDropdown model="anthropic/claude-haiku-4-5" />);
    expect(screen.getByTestId('model-dropdown-trigger').textContent).toContain('Haiku 4.5');
  });

  it('opens the menu on trigger click and closes on second click', () => {
    renderWithTheme(<ModelDropdown />);
    const trigger = screen.getByTestId('model-dropdown-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    act(() => fireEvent.click(trigger));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    act(() => fireEvent.click(trigger));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders one option per MODELS entry across all provider groups', () => {
    renderWithTheme(<ModelDropdown />);
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));

    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    // Total options = MODELS.length (one per registered (provider, id) pair).
    expect(options).toHaveLength(MODELS.length);
  });

  it('marks aria-selected on the currently picked model', () => {
    setModelPref({ provider: 'openrouter', modelId: 'anthropic/claude-sonnet-4-6' });
    renderWithTheme(<ModelDropdown />);
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));

    const selected = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain('Sonnet 4.6');
  });

  it('disables (aria-disabled=true) every option in a provider group with no API key', () => {
    // No keys set → every group should be disabled.
    renderWithTheme(<ModelDropdown />);
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.every((o) => o.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  it('enables only the provider group whose key is set', () => {
    byokKey.set('anthropic', 'sk-ant-test');
    renderWithTheme(<ModelDropdown />);
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));

    // Anthropic options should be enabled; openrouter + openai should be disabled.
    const listbox = screen.getByRole('listbox');
    const anthropicOpt = within(listbox).getByTestId('model-option-anthropic-claude-sonnet-4-6');
    expect(anthropicOpt.getAttribute('aria-disabled')).toBe('false');
    const openaiOpt = within(listbox).getByTestId('model-option-openai-gpt-4o-mini');
    expect(openaiOpt.getAttribute('aria-disabled')).toBe('true');
    const openrouterOpt = within(listbox).getByTestId(
      'model-option-openrouter-anthropic/claude-haiku-4-5',
    );
    expect(openrouterOpt.getAttribute('aria-disabled')).toBe('true');
  });

  it('selecting an enabled option persists the (provider, modelId) pair, calls onChange, and closes the menu', () => {
    byokKey.set('openrouter', 'sk-or-test');
    const onChange = vi.fn();
    renderWithTheme(<ModelDropdown onChange={onChange} />);
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));

    const opusItem = screen.getByTestId('model-option-openrouter-anthropic/claude-opus-4-7');
    act(() => fireEvent.click(opusItem));

    expect(onChange).toHaveBeenCalledWith('anthropic/claude-opus-4-7');
    expect(loadStoredModel()).toBe('anthropic/claude-opus-4-7');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('model-dropdown-trigger').textContent).toContain('Opus 4.7');
  });

  it('clicking a disabled option is a no-op (no persist, no onChange, menu stays open)', () => {
    const onChange = vi.fn();
    renderWithTheme(<ModelDropdown onChange={onChange} />);
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));

    // No keys set → openai option is disabled.
    const openaiItem = screen.getByTestId('model-option-openai-gpt-4o-mini');
    act(() => fireEvent.click(openaiItem));

    expect(onChange).not.toHaveBeenCalled();
    expect(loadStoredModel()).toBe(DEFAULT_MODEL_ID); // unchanged
    expect(screen.queryByRole('listbox')).not.toBeNull(); // still open
  });

  it('subscribes to model-change events and re-reads storage on emit', () => {
    renderWithTheme(<ModelDropdown />);
    expect(screen.getByTestId('model-dropdown-trigger').textContent).toContain('Sonnet 4.6');

    act(() => {
      setModelPref({ provider: 'openrouter', modelId: 'anthropic/claude-haiku-4-5' });
      emitModelChange();
    });

    expect(screen.getByTestId('model-dropdown-trigger').textContent).toContain('Haiku 4.5');
  });

  it('outside-click closes the menu', () => {
    renderWithTheme(
      <div>
        <ModelDropdown />
        <button type="button" data-testid="outside">
          outside
        </button>
      </div>,
    );
    act(() => fireEvent.click(screen.getByTestId('model-dropdown-trigger')));
    expect(screen.queryByRole('listbox')).not.toBeNull();

    act(() => fireEvent.mouseDown(screen.getByTestId('outside')));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  describe('exports', () => {
    it('persistModel writes provider + modelId through to localStorage', () => {
      persistModel('openrouter', 'anthropic/claude-opus-4-7');
      expect(loadStoredModel()).toBe('anthropic/claude-opus-4-7');
    });

    it('loadStoredModel returns DEFAULT_MODEL_ID when storage is empty', () => {
      expect(loadStoredModel()).toBe(DEFAULT_MODEL_ID);
    });
  });
});
