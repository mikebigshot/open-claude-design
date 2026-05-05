// Public surface of the chat feature.

export { ChatPanel } from './ChatPanel';
export type { ChatPanelProps } from './ChatPanel';
export { ChatMsg } from './ChatMsg';
export { Composer } from './Composer';
export type { ComposerProps } from './Composer';
export { CommentsTab } from './CommentsTab';
export { ActivityTab } from './ActivityTab';
export { ImportPopover } from './ImportPopover';
export { ModelDropdown, MODEL_OPTIONS, loadStoredModel, persistModel } from './ModelDropdown';
export { useAgentChat } from './use-agent-chat';
export type { UseAgentChatOptions, UseAgentChatHandle } from './use-agent-chat';
export type { DesignAgentUIMessage } from './ui-messages';
export type { ActivityEntry, ChatTab, ChipPrim, Pin } from './types';
