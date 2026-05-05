// Chat history persistence wire format.
//
// `messages` 字段是 Vercel AI SDK 的 `UIMessage[]`（含 id / role / parts —— parts
// 里有 text / tool calls / reasoning / 等结构）。Contracts 包不引 'ai' 运行时依赖，
// 这里用 `unknown[]` 占位；client 端类型化为 UIMessage[]、worker 端只做 JSON
// round-trip + 抽 id/role/position 入库。
//
// 模型：每个 project 下 N 条 Chat（多 chat 支持，Task 2）；每条 Chat 持有自己的
// messages timeline。messages 表加了 chat_id 外键。
//
// PUT 是整 thread 替换（按 chatId 范围内删旧的 + bulk INSERT 新的），server 内部
// transaction。详见 routes/messages.ts。
//
// 兼容性：?chatId= 是 GET 必填、PUT body.chatId 必填。早期单 chat 模型下 messages
// 没有 chat_id 列，迁移 0006 把所有现有 messages 归到一个新建 default chat。

export interface ListMessagesResponse {
  messages: unknown[];
}

export interface PutMessagesRequest {
  /** 必填：消息归属哪个 chat。 */
  chatId: string;
  messages: unknown[];
}

export interface PutMessagesResponse {
  /** 写入后的总条数（= request.messages.length）。 */
  count: number;
}
