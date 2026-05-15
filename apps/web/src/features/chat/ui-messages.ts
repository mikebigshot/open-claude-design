import type { InferAgentUIMessage } from 'ai';
import { createAgent } from './agent.js';

/**
 * v2 attachment schema (research/claude-design-v2/05-skills-system.md +
 * artifacts/projectdata-test.json). Persisted user messages may carry one
 * or more attachments that the client inlines into the outgoing text block
 * via XML wrappers BEFORE the message hits the model.
 *
 * Owned by W3 (this slice); W1's wrapped sendMessage in `use-agent-chat.ts`
 * is the consumer — it calls `inlineAttachmentsIntoText(text, attachments)`
 * before forwarding to the AI SDK chat.
 */
export type AttachmentType = 'skill' | 'designSystem' | 'file' | 'canvas' | 'folder';

export interface Attachment {
  id: string;
  name: string;
  type: AttachmentType;
  /**
   * Full prompt text or guide body to inline before the user's prose.
   * For type='skill' this is the skill's SKILL.md body; for type='designSystem'
   * it's the design-system guide; etc.
   */
  content: string;
}

type Inferred = InferAgentUIMessage<ReturnType<typeof createAgent>>;

/**
 * UI message type with typed tool parts (tool-edit_file, tool-read_file, ...).
 *
 * Extended with optional `attachments[]` carrying v2's persisted-attachment
 * shape. ChatMsg.tsx renders them as chips under the user bubble; W1's
 * sendMessage wrapper inlines their content into the outgoing text.
 * Absent on assistant-role messages.
 */
export type DesignAgentUIMessage = Inferred & {
  attachments?: Attachment[];
};
