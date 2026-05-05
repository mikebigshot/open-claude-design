// Chat (multi-chat) wire format.
//
// 一个 project 下可以有多条 Chat，每条 Chat 持有自己的 messages timeline。
// 命名采用 Chat（UI 里就叫 "New Chat"）。
//
// 关键设计：
// - id 由客户端生成（crypto.randomUUID），让 optimistic create 在 round-trip 前
//   就能拿稳定 key。
// - title 可空：UI 里 nullable 显示成 "New chat"；agent 第一轮回复后由前端按
//   user prompt 摘取一份默认 title（推迟到后续 task）。
// - createdAt / updatedAt 都是 ISO8601 string，统一项目其他表习惯（projects /
//   files / messages）。
// - messages 表加 chat_id 外键 → ON DELETE CASCADE；删 chat 时 messages 一起走。
//
// 持久化端点（apps/api/src/routes/chats.ts）：
//   GET    /api/projects/:id/chats           ListChats
//   POST   /api/projects/:id/chats           CreateChat（body: { id, title? }）
//   PATCH  /api/projects/:id/chats/:chatId   UpdateChat（body: { title? }）
//   DELETE /api/projects/:id/chats/:chatId   DeleteChat（cascades messages）
//
// messages 路由 (../routes/messages.ts) 加 ?chatId= 过滤 + body 要求 chatId。

export interface Chat {
  id: string;
  projectId: string;
  /** 客户端可改名；空表示尚未命名（UI 显示 "New chat"）。 */
  title: string | null;
  /** ISO8601。 */
  createdAt: string;
  /** ISO8601；最后一次写消息或改 title 时更新。 */
  updatedAt: string;
}

export interface ListChatsResponse {
  chats: Chat[];
}

export interface CreateChatRequest {
  /** 客户端生成 UUID（optimistic UI）。 */
  id: string;
  /** 可选 title；后端 INSERT 时若缺省落 NULL。 */
  title?: string | null;
}

export interface CreateChatResponse {
  chat: Chat;
}

export interface PatchChatRequest {
  /** 改 title；显式 null = 清空 title。omit 则不动。 */
  title?: string | null;
}

export interface PatchChatResponse {
  chat: Chat;
}
