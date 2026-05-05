// Workspace 内的真组件 slot —— sub-agent 写好的组件挂载点。
//
// ChatPanelSlot     → features/chat/ChatPanel       （chat agent）
// PreviewPanelSlot  → features/preview/PreviewPanel  （preview agent，已直接用 useWorkspace）
//
// Task 8 后 ChatPanel 接受 selection prop 由外部 (Workspace.tsx) 控制 ——
// SecondaryHeader 里的 ChatTabBar 决定显示 chat thread / Comments / Activity。

import { ChatPanel } from '@/features/chat/ChatPanel';
import { TodosPanel } from '@/features/chat/TodosPanel';
import { TodosProvider } from '@/features/chat/todos-state';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { useWorkspace } from '@/state/workspace';
import type { ChatViewSelection } from './ChatTabBar';

export interface ChatPanelSlotProps {
  /**
   * 当前在 SecondaryHeader 上选中的视图。Workspace.tsx 持有这个 state，
   * 同步给 ChatTabBar 和 ChatPanel；切 chat tab → ChatPanel 重 hydrate
   * messages，切 Comments/Activity → ChatPanel 切视图但 chat instance 不重建。
   */
  selection: ChatViewSelection;
}

// ChatPanel 走 useAgentChat（Vercel AI SDK ToolLoopAgent + BYOK key）。
// messages 由 useChat 内部持有；TodosProvider 包裹让 useTodos() 在
// useAgentChat 里有真实 context。
export function ChatPanelSlot({ selection }: ChatPanelSlotProps) {
  const { state } = useWorkspace();
  return (
    <TodosProvider>
      <ChatPanel projectId={state.projectId} selection={selection} />
      <TodosPanel />
    </TodosProvider>
  );
}

// PreviewPanel 已经直接 useWorkspace —— 完全联通 tool / tweaks / edit / pins 等状态。
export function PreviewPanelSlot() {
  return <PreviewPanel />;
}
