// QuestionsForm — UI for the questions_v2 tool. Renders 5 question kinds.
//
// We test rendering + interaction for each kind, then submit / cancel paths.
// Real DOM via @testing-library; no chrome mocking.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';

import { formatAnswers, QuestionsForm } from './QuestionsForm';
import type { QuestionsV2InputT } from './tools/questions-v2';

function renderForm(data: QuestionsV2InputT) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <QuestionsForm data={data} onSubmit={onSubmit} onCancel={onCancel} />
    </ThemeProvider>,
  );
  return { onSubmit, onCancel };
}

afterEach(() => cleanup());

describe('QuestionsForm', () => {
  it('renders the form title', () => {
    renderForm({ title: 'Quick questions about the landing page', questions: [] });
    expect(screen.getByText('Quick questions about the landing page')).toBeTruthy();
  });

  it('renders text-options as radio buttons (single-select default)', () => {
    renderForm({
      title: 'X',
      questions: [
        {
          id: 'audience',
          kind: 'text-options',
          title: 'Who is this for?',
          options: ['Designers', 'PMs', 'Engineers'],
        },
      ],
    });
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(3);
  });

  it('renders text-options as checkboxes when multi=true', () => {
    renderForm({
      title: 'X',
      questions: [
        {
          id: 'features',
          kind: 'text-options',
          title: 'Pick features',
          options: ['Auth', 'Dark mode', 'Realtime'],
          multi: true,
        },
      ],
    });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBe(3);
  });

  it('renders svg-options as buttons containing inline SVG', () => {
    renderForm({
      title: 'Layout',
      questions: [
        {
          id: 'layout',
          kind: 'svg-options',
          title: 'Pick a layout',
          options: [
            '<svg viewBox="0 0 80 56" xmlns="http://www.w3.org/2000/svg"><rect width="80" height="56"/></svg>',
            '<svg viewBox="0 0 80 56" xmlns="http://www.w3.org/2000/svg"><circle cx="40" cy="28" r="20"/></svg>',
          ],
        },
      ],
    });
    const buttons = screen.getAllByRole('button');
    // 2 svg-option cards + Submit + Cancel
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders slider with min/max/step/default', () => {
    renderForm({
      title: 'Density',
      questions: [
        {
          id: 'density',
          kind: 'slider',
          title: 'Density',
          min: 0,
          max: 100,
          step: 5,
          default: 50,
        },
      ],
    });
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('100');
    expect(slider.step).toBe('5');
    expect(slider.value).toBe('50');
  });

  it('renders file picker with accept', () => {
    renderForm({
      title: 'Logo',
      questions: [{ id: 'logo', kind: 'file', title: 'Upload logo', accept: 'image/*' }],
    });
    const file = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file).toBeTruthy();
    expect(file.accept).toBe('image/*');
  });

  it('renders freeform as a textarea', () => {
    renderForm({
      title: 'Notes',
      questions: [{ id: 'notes', kind: 'freeform', title: 'Anything else?' }],
    });
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('submit serializes answers as a JSON-friendly object keyed by question id', () => {
    const { onSubmit } = renderForm({
      title: 'X',
      questions: [
        {
          id: 'audience',
          kind: 'text-options',
          title: 'Who?',
          options: ['Designers', 'PMs'],
        },
        { id: 'notes', kind: 'freeform', title: 'Notes' },
      ],
    });
    // Pick the first radio
    const radio = screen.getAllByRole('radio')[0] as HTMLInputElement;
    fireEvent.click(radio);
    // Type into freeform
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello world' } });
    // Submit
    const submit = screen.getByRole('button', { name: /submit/i });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.audience).toBe('Designers');
    expect(arg.notes).toBe('hello world');
  });

  it('multi-select aggregates checked options into an array', () => {
    const { onSubmit } = renderForm({
      title: 'X',
      questions: [
        {
          id: 'features',
          kind: 'text-options',
          title: 'Pick features',
          options: ['Auth', 'Dark mode', 'Realtime'],
          multi: true,
        },
      ],
    });
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[2]!);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    const arg = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.features).toEqual(['Auth', 'Realtime']);
  });

  it('slider value submits as the current numeric value', () => {
    const { onSubmit } = renderForm({
      title: 'X',
      questions: [{ id: 'density', kind: 'slider', title: 'Density', min: 0, max: 10, default: 3 }],
    });
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    const arg = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.density).toBe(7);
  });

  it('cancel button invokes onCancel and not onSubmit', () => {
    const { onSubmit, onCancel } = renderForm({
      title: 'X',
      questions: [{ id: 'q', kind: 'freeform', title: 'X' }],
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('formatAnswers() returns indented JSON suitable for inlining into a chat reply', () => {
    const text = formatAnswers({ audience: 'Designers', density: 50 });
    expect(text).toContain('"audience"');
    expect(text).toContain('"Designers"');
    expect(text).toContain('"density"');
    expect(text).toContain('50');
  });

  it('subtitle is rendered when present', () => {
    renderForm({
      title: 'X',
      questions: [
        {
          id: 'q',
          kind: 'freeform',
          title: 'Question one',
          subtitle: 'Optional subtitle line',
        },
      ],
    });
    expect(screen.getByText('Optional subtitle line')).toBeTruthy();
  });

  it('omits empty answers from submit payload (un-touched freeform → undefined)', () => {
    const { onSubmit } = renderForm({
      title: 'X',
      questions: [
        { id: 'a', kind: 'freeform', title: 'A' },
        { id: 'b', kind: 'freeform', title: 'B' },
      ],
    });
    const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    fireEvent.change(textareas[0]!, { target: { value: 'only A' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    const arg = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.a).toBe('only A');
    expect(arg.b).toBeUndefined();
  });
});
