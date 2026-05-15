// Visual-evidence test — dumps the rendered HTML for ChatMsg when it
// receives a tool-questions_v2 part. Not assertive; the artifact is the
// console-printed DOM snippet that the parent agent will paste into its
// final report (visual evidence of F1.1 working end-to-end). Skipped in
// CI to avoid polluting test output.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { theme } from '@/theme/theme';
import { ChatMsg } from '../ChatMsg';
import type { DesignAgentUIMessage } from '../ui-messages';

describe('ChatMsg visual evidence (skipped in CI by default)', () => {
  it.skip('renders tool-questions_v2 as an interactive form (DOM dump)', () => {
    const message = {
      id: 'visual-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-questions_v2',
          state: 'output-available',
          input: {
            title: "Let's design something great for your startup",
            questions: [
              {
                id: 'audience',
                kind: 'text-options',
                title: 'Who is this for?',
                options: ['Designers', 'PMs', 'Engineers', 'Decide for me'],
              },
              {
                id: 'feel',
                kind: 'svg-options',
                title: 'Pick a vibe',
                options: [
                  '<svg viewBox="0 0 80 56"><rect width="80" height="56" fill="#fef3c7"/></svg>',
                  '<svg viewBox="0 0 80 56"><rect width="80" height="56" fill="#1f2937"/></svg>',
                ],
              },
              {
                id: 'density',
                kind: 'slider',
                title: 'Information density',
                min: 0,
                max: 10,
                default: 5,
              },
              {
                id: 'logo',
                kind: 'file',
                title: 'Upload your logo (optional)',
                accept: 'image/*',
              },
              {
                id: 'notes',
                kind: 'freeform',
                title: 'Anything else?',
                subtitle: 'Optional — short paragraphs are fine.',
              },
            ],
          },
          toolCallId: 'visual-tcid-1',
        },
      ],
    } as unknown as DesignAgentUIMessage;

    const { container } = render(
      <ThemeProvider theme={theme}>
        <ChatMsg message={message} onSubmitQuestions={() => {}} onCancelQuestions={() => {}} />
      </ThemeProvider>,
    );
    // Strip styled-components class clutter for readability when printing
    const cleaned = container.innerHTML.replace(/\s*class="[^"]*"/g, '');
    /* eslint-disable no-console */
    console.log('\n========== F1.1 visual evidence (questions_v2 form) ==========');
    console.log(cleaned);
    console.log('================================================================\n');
    expect(container.textContent).toContain("Let's design something great for your startup");
  });
});
