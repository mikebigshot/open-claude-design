// Renders one UIMessage from the AI SDK ToolLoopAgent.
//
// Message shape: { id, role: 'user' | 'assistant', parts: Part[] }
//
// Part types rendered:
//   - text                  → prose bubble (user = grey bg, assistant = logo header)
//   - file (image/*)        → thumbnail row inside user bubble (preserves history)
//   - tool-edit_file        → "Writing <path>" chip
//   - tool-read_file        → "Reading <path>" chip
//   - tool-list_files       → "Listing files" chip
//   - tool-mark_done        → "Done <message>" chip
//   - anything else that isToolUIPart() → generic "Tool <name>" chip
//
// State machine per tool part (from common-errors.md):
//   input-streaming  → spinner / "…"
//   input-available  → executing
//   output-available → finished
//   output-error     → error

import styled, { useTheme } from 'styled-components';
import { isToolUIPart } from 'ai';
import { useT } from '@/i18n';
import { IconLogo } from './icons';
import type { DesignAgentUIMessage } from './ui-messages';

type TFn = ReturnType<typeof useT>;

interface Props {
  message: DesignAgentUIMessage;
}

// ───── styled components ─────

const UserBubble = styled.div`
  margin-bottom: 18px;
  padding: 10px 12px;
  background: ${(p) => p.theme.colors.bg200};
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.55;
  white-space: pre-wrap;
`;

// User-attached image preview row inside UserBubble — square 88×88 with
// generous radius, matches claude.ai/design's chat-history thumbnail style
// (portrait shape is reserved for the composer's pre-send staging area).
const UserAttachments = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
`;

const UserAttachmentImg = styled.img`
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid ${(p) => p.theme.colors.line100};
  display: block;
`;

const AtelierBlock = styled.div`
  margin-bottom: 16px;
  font-size: 13.5px;
  line-height: 1.6;
`;

const AtelierHeader = styled.div`
  font-size: 11px;
  color: ${(p) => p.theme.colors.fg400};
  margin-bottom: 4px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const AtelierText = styled.div`
  white-space: pre-wrap;
`;

const MonoFramedBlock = styled.div`
  margin-bottom: 16px;
  padding: 10px;
  background: ${(p) => p.theme.colors.bg50};
  border: 1px solid ${(p) => p.theme.colors.line100};
  border-radius: 10px;
  font-family: ${(p) => p.theme.fonts.mono};
  font-size: 11px;
`;

const ToolRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
`;

const ToolVerb = styled.span<{ $color: string }>`
  color: ${(p) => p.$color};
  font-weight: 600;
  width: 60px;
  font-size: 10.5px;
`;

const ToolTarget = styled.span`
  color: ${(p) => p.theme.colors.fg200};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
`;

const ToolStateBadge = styled.span<{ $state: string }>`
  margin-left: auto;
  font-size: 9px;
  color: ${(p) => {
    switch (p.$state) {
      case 'output-available':
        return p.theme.colors.success ?? '#22c55e';
      case 'output-error':
      case 'output-denied':
        return p.theme.colors.danger ?? '#ef4444';
      default:
        return p.theme.colors.fg400 ?? '#888';
    }
  }};
`;

// ───── component ─────

export function ChatMsg({ message }: Props) {
  const theme = useTheme();
  const t = useT();

  const isUser = message.role === 'user';

  if (isUser) {
    // User messages: text parts as bubble text + image file parts as thumbnail row.
    // Without the file-part branch, paste/upload attachments disappear from chat
    // history after send (regression observed against claude.ai/design parity).
    const textContent = message.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('');
    const imageParts = message.parts.filter(
      (p): p is Extract<typeof p, { type: 'file' }> =>
        p.type === 'file' && (p.mediaType?.startsWith('image/') ?? false),
    );

    return (
      <UserBubble>
        {textContent || (imageParts.length === 0 ? ' ' : null)}
        {imageParts.length > 0 && (
          <UserAttachments>
            {imageParts.map((p, i) => (
              <UserAttachmentImg
                key={`img-${i}`}
                src={p.url}
                alt={('filename' in p && p.filename) || 'attached image'}
              />
            ))}
          </UserAttachments>
        )}
      </UserBubble>
    );
  }

  // Assistant messages: render parts in order.
  // Group consecutive tool parts into a single framed block for visual coherence.
  const elements: React.ReactNode[] = [];
  let toolBuffer: React.ReactNode[] = [];

  const flushTools = () => {
    if (toolBuffer.length === 0) return;
    elements.push(<MonoFramedBlock key={`tools-${elements.length}`}>{toolBuffer}</MonoFramedBlock>);
    toolBuffer = [];
  };

  message.parts.forEach((part, i) => {
    if (part.type === 'text') {
      flushTools();
      if (part.text) {
        elements.push(
          <AtelierBlock key={`text-${i}`}>
            <AtelierHeader>
              <IconLogo size={11} /> Atelier
            </AtelierHeader>
            <AtelierText>{part.text}</AtelierText>
          </AtelierBlock>,
        );
      }
    } else if (isToolUIPart(part)) {
      // Derive display verb + target from tool type.
      const { verb, verbColor, target } = toolDisplay(part, theme, t);
      toolBuffer.push(
        <ToolRow key={`tool-${i}-${part.toolCallId}`}>
          <ToolVerb $color={verbColor}>{verb}</ToolVerb>
          {target && <ToolTarget title={target}>{target}</ToolTarget>}
          <ToolStateBadge $state={part.state}>{stateLabel(part.state)}</ToolStateBadge>
        </ToolRow>,
      );
    }
  });

  flushTools();

  return <>{elements}</>;
}

// ───── helpers ─────

/** Generic tool part shape we extract from the SDK's discriminated union. */
interface GenericToolPart {
  type: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  toolCallId: string;
  toolName?: string;
}

/** Cast a tool UI part to a generic shape we can safely read. */
function asGenericTool(part: unknown): GenericToolPart {
  return part as GenericToolPart;
}

function toolDisplay(
  rawPart: unknown,
  theme: { colors: Record<string, string | undefined>; fonts: Record<string, string | undefined> },
  t: TFn,
): { verb: string; verbColor: string; target: string } {
  const part = asGenericTool(rawPart);

  const c = (key: string) => theme.colors[key] ?? '#888';

  // Derive target: file path or message depending on tool.
  const inputPath = part.input?.path as string | undefined;
  const inputMessage = part.input?.message as string | undefined;

  switch (part.type) {
    case 'tool-edit_file':
      return {
        verb: t('chat.tool.writing'),
        verbColor: c('info'),
        target: inputPath ?? '',
      };
    case 'tool-read_file':
      return {
        verb: t('chat.tool.reading'),
        verbColor: c('fg300'),
        target: inputPath ?? '',
      };
    case 'tool-list_files':
      return {
        verb: t('chat.tool.listing'),
        verbColor: c('fg300'),
        target: inputPath ?? 'files',
      };
    case 'tool-mark_done':
      return {
        verb: t('chat.tool.done'),
        verbColor: c('success'),
        target: inputMessage ?? '',
      };
    default: {
      // Generic fallback: strip 'tool-' prefix.
      const name = part.type.startsWith('tool-') ? part.type.slice(5) : part.type;
      return {
        verb: name.toUpperCase().slice(0, 8),
        verbColor: c('fg300'),
        target: inputPath ?? inputMessage ?? '',
      };
    }
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case 'input-streaming':
      return '…';
    case 'input-available':
      return '⟳';
    case 'output-available':
      return '✓';
    case 'output-error':
      return '✗';
    case 'output-denied':
      return '✗';
    default:
      return '';
  }
}
