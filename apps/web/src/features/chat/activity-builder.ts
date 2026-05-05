// Build ActivityTab entries from real workspace state.
//
// 来源：
//   1. useChat() messages —— 每个 tool part `output-available` 一条
//   2. workspace.pins —— 每个 pin 一条 comment 事件
//
// UIMessage 本身不带 timestamp，所以工具事件的 `t` 留空（按消息列表自然顺序
// 已经是时序）；pin 有 createdAt → 格式化为 "HH:MM"。

import type { DefaultTheme } from 'styled-components';

import type { CommentPin } from '@/state/types';
import type { ActivityEntry } from './types';

interface MessagePart {
  type?: string;
  state?: string;
  input?: Record<string, unknown>;
}

/**
 * Loose shape for any chat message holding tool parts.
 * Vercel AI SDK's UIMessage matches structurally; we type it openly here so
 * the builder doesn't need a hard dep on the SDK.
 */
interface MessageLike {
  id: string;
  parts?: readonly unknown[];
}

interface ToolDef {
  verb: string;
  colorKey: keyof DefaultTheme['colors'];
}

const TOOL_VERB_MAP: Record<string, ToolDef> = {
  'tool-edit_file': { verb: 'wrote', colorKey: 'info' },
  'tool-write_file': { verb: 'wrote', colorKey: 'info' },
  'tool-read_file': { verb: 'read', colorKey: 'fg300' },
  'tool-list_files': { verb: 'listed', colorKey: 'fg300' },
  'tool-grep': { verb: 'searched', colorKey: 'fg300' },
  'tool-delete_file': { verb: 'deleted', colorKey: 'danger' },
  'tool-copy_files': { verb: 'copied', colorKey: 'info' },
  'tool-str_replace_based_edit_tool': { verb: 'edited', colorKey: 'info' },
  'tool-mark_done': { verb: 'done', colorKey: 'success' },
  'tool-done': { verb: 'done', colorKey: 'success' },
  'tool-update_todos': { verb: 'updated todos', colorKey: 'fg300' },
  'tool-invoke_skill': { verb: 'invoked skill', colorKey: 'brandPress' },
  'tool-view_image': { verb: 'viewed', colorKey: 'fg300' },
  'tool-web_fetch': { verb: 'fetched', colorKey: 'fg300' },
};

function getColor(theme: DefaultTheme, key: keyof DefaultTheme['colors']): string {
  return theme.colors[key] ?? theme.colors.fg300 ?? '#888';
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function targetFromInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  return (
    (input.path as string | undefined) ??
    (input.message as string | undefined) ??
    (input.name as string | undefined) ??
    ''
  );
}

export function buildActivityEntries(
  messages: readonly MessageLike[],
  pins: readonly CommentPin[],
  theme: DefaultTheme,
  limit = 50,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  // Tool events from messages (preserve order: oldest → newest, then we
  // reverse the whole list at the end so newest-first lands at the top).
  let nthInMsg = 0;
  for (const msg of messages) {
    if (!msg.parts) continue;
    for (const raw of msg.parts) {
      const part = raw as MessagePart;
      const type = part.type;
      if (typeof type !== 'string' || !type.startsWith('tool-')) continue;
      if (part.state !== 'output-available') continue;

      const def = TOOL_VERB_MAP[type] ?? { verb: type.slice(5), colorKey: 'fg300' as const };
      const target = targetFromInput(part.input);
      entries.push({
        id: `${msg.id}-${nthInMsg++}`,
        t: '',
        who: 'Atelier',
        what: target ? `${def.verb} ${target}` : def.verb,
        color: getColor(theme, def.colorKey),
      });
    }
  }

  // Pin events
  for (const pin of pins) {
    const targetStr = pin.selector ?? `at (${Math.round(pin.x)}, ${Math.round(pin.y)})`;
    const truncated = pin.text.length > 40 ? `${pin.text.slice(0, 37)}…` : pin.text;
    entries.push({
      id: `pin-${pin.id}`,
      t: formatTime(pin.createdAt),
      who: 'You',
      what: truncated ? `commented "${truncated}"` : `pin ${targetStr}`,
      color: getColor(theme, 'brandBase'),
    });
  }

  // Newest first; cap.
  return entries.slice(-limit).reverse();
}
