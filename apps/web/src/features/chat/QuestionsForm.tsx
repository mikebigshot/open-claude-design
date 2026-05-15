// QuestionsForm — UI surface for the questions_v2 tool. Renders 5 question
// kinds: text-options / svg-options / slider / file / freeform.
//
// The agent ends its turn after calling questions_v2; ChatPanel detects the
// tool call's output and renders this form. On submit, formatAnswers() turns
// the answers map into a JSON string; ChatPanel injects that as a new user
// message via chat.sendMessage().

import { useMemo, useState } from 'react';
import styled from 'styled-components';

import type { QuestionT, QuestionsV2InputT } from './tools/questions-v2.js';

export interface QuestionsFormProps {
  data: QuestionsV2InputT;
  onSubmit: (answers: Record<string, unknown>) => void;
  onCancel: () => void;
}

/**
 * Format answers as indented JSON. The agent reads the resulting block as a
 * structured response (matches v2 protocol — question_id → answer map).
 */
export function formatAnswers(answers: Record<string, unknown>): string {
  return JSON.stringify(answers, null, 2);
}

// ---------- styled ---------------------------------------------------------

const Wrap = styled.div`
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 12px;
  padding: 14px 16px;
  background: ${(p) => p.theme.colors.bg50};
  margin: 8px 0;
`;

const Title = styled.h3`
  font-family: ${(p) => p.theme.fonts.sans};
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => p.theme.colors.fg100};
  margin: 0 0 12px;
`;

const QuestionBlock = styled.div`
  margin-bottom: 16px;
  &:last-of-type {
    margin-bottom: 12px;
  }
`;

const QuestionTitle = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${(p) => p.theme.colors.fg100};
  margin-bottom: 4px;
`;

const QuestionSubtitle = styled.div`
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg300};
  margin-bottom: 8px;
`;

const TextRow = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: ${(p) => p.theme.colors.fg100};
  &:hover {
    background: ${(p) => p.theme.colors.bg100};
  }
  & input {
    margin-top: 2px;
  }
`;

const SvgGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 8px;
`;

const SvgCard = styled.button<{ $selected: boolean }>`
  cursor: pointer;
  background: ${(p) => p.theme.colors.bg100};
  border: 2px solid ${(p) => (p.$selected ? p.theme.colors.brandBase : p.theme.colors.line100)};
  border-radius: 8px;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  & svg {
    max-width: 80px;
    max-height: 56px;
  }
  &:hover {
    border-color: ${(p) => p.theme.colors.brandSoft};
  }
`;

const Slider = styled.input.attrs({ type: 'range' })`
  width: 100%;
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const SliderValue = styled.span`
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg200};
  min-width: 32px;
  text-align: right;
`;

const TextArea = styled.textarea`
  width: 100%;
  min-height: 60px;
  resize: vertical;
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 8px;
  padding: 8px 10px;
  font-family: ${(p) => p.theme.fonts.sans};
  font-size: 13px;
  color: ${(p) => p.theme.colors.fg100};
  background: ${(p) => p.theme.colors.bg50};
  &:focus {
    outline: none;
    border-color: ${(p) => p.theme.colors.brandBase};
  }
`;

const FileInput = styled.input.attrs({ type: 'file' })`
  font-family: ${(p) => p.theme.fonts.sans};
  font-size: 12px;
  color: ${(p) => p.theme.colors.fg200};
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
`;

const SubmitButton = styled.button`
  padding: 6px 14px;
  background: ${(p) => p.theme.colors.brandBase};
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  &:hover {
    background: ${(p) => p.theme.colors.brandHover};
  }
`;

const CancelButton = styled.button`
  padding: 6px 14px;
  background: transparent;
  color: ${(p) => p.theme.colors.fg200};
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  &:hover {
    background: ${(p) => p.theme.colors.bg100};
  }
`;

// ---------- component ------------------------------------------------------

interface AnswerState {
  // Single text-options selection (label) | multi (label[]) | slider (number) | file (filename) | freeform (string) | svg-options (label).
  [questionId: string]: unknown;
}

function defaultFor(q: QuestionT): unknown {
  if (q.kind === 'slider') return q.default ?? q.min ?? 0;
  if (q.kind === 'text-options' && q.multi) return [] as string[];
  return undefined;
}

export function QuestionsForm({ data, onSubmit, onCancel }: QuestionsFormProps) {
  const initial = useMemo<AnswerState>(() => {
    const out: AnswerState = {};
    for (const q of data.questions) {
      const v = defaultFor(q);
      if (v !== undefined) out[q.id] = v;
    }
    return out;
  }, [data.questions]);

  const [answers, setAnswers] = useState<AnswerState>(initial);

  function setAnswer(id: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleMulti(id: string, value: string) {
    setAnswers((prev) => {
      const current = (prev[id] as string[] | undefined) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [id]: next };
    });
  }

  function handleSubmit() {
    // Strip undefined values so the agent gets a clean JSON-like payload.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (v === undefined) continue;
      if (typeof v === 'string' && v === '') continue;
      out[k] = v;
    }
    onSubmit(out);
  }

  return (
    <Wrap role="form" aria-label="questions">
      <Title>{data.title}</Title>
      {data.questions.map((q) => (
        <QuestionBlock key={q.id}>
          <QuestionTitle>{q.title}</QuestionTitle>
          {q.subtitle ? <QuestionSubtitle>{q.subtitle}</QuestionSubtitle> : null}
          {renderKind(q, answers, setAnswer, toggleMulti)}
        </QuestionBlock>
      ))}
      <Actions>
        <CancelButton type="button" onClick={onCancel}>
          Cancel
        </CancelButton>
        <SubmitButton type="button" onClick={handleSubmit}>
          Submit
        </SubmitButton>
      </Actions>
    </Wrap>
  );
}

function renderKind(
  q: QuestionT,
  answers: AnswerState,
  setAnswer: (id: string, value: unknown) => void,
  toggleMulti: (id: string, value: string) => void,
) {
  if (q.kind === 'text-options') {
    const opts = q.options ?? [];
    const isMulti = q.multi === true;
    return (
      <div>
        {opts.map((opt) => {
          const checked = isMulti
            ? ((answers[q.id] as string[] | undefined) ?? []).includes(opt)
            : answers[q.id] === opt;
          return (
            <TextRow key={opt}>
              <input
                type={isMulti ? 'checkbox' : 'radio'}
                name={q.id}
                value={opt}
                checked={checked}
                onChange={() => (isMulti ? toggleMulti(q.id, opt) : setAnswer(q.id, opt))}
              />
              <span>{opt}</span>
            </TextRow>
          );
        })}
      </div>
    );
  }
  if (q.kind === 'svg-options') {
    const opts = q.options ?? [];
    return (
      <SvgGrid>
        {opts.map((svg, i) => {
          const value = `option-${i}`;
          const selected = answers[q.id] === value;
          return (
            <SvgCard
              type="button"
              key={value}
              aria-label={`option ${i + 1}`}
              aria-pressed={selected}
              $selected={selected}
              onClick={() => setAnswer(q.id, value)}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          );
        })}
      </SvgGrid>
    );
  }
  if (q.kind === 'slider') {
    const min = q.min ?? 0;
    const max = q.max ?? 100;
    const step = q.step ?? 1;
    const value =
      typeof answers[q.id] === 'number' ? (answers[q.id] as number) : (q.default ?? min);
    return (
      <SliderRow>
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={q.title}
          onChange={(e) => setAnswer(q.id, Number((e.target as HTMLInputElement).value))}
        />
        <SliderValue>{value}</SliderValue>
      </SliderRow>
    );
  }
  if (q.kind === 'file') {
    return (
      <FileInput
        accept={q.accept}
        aria-label={q.title}
        onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          setAnswer(q.id, file?.name ?? '');
        }}
      />
    );
  }
  // freeform
  const text = (answers[q.id] as string | undefined) ?? '';
  return (
    <TextArea
      placeholder=""
      aria-label={q.title}
      value={text}
      onChange={(e) => setAnswer(q.id, (e.target as HTMLTextAreaElement).value)}
    />
  );
}
