// Shared TypeScript API contracts between web and api.
// Slice ownership:
//  - chat.ts:    chat model / message types (agent SDK switch: SSE types removed)
//  - chats.ts:   multi-chat container (Task 2: 多 chat 支持)
//  - comments.ts: pin / comment persistence (post-MVP follow-up)
//  - files.ts:   slice 3 (storage)
//  - messages.ts: chat history persistence (post-MVP follow-up)
//  - projects.ts: slice 8 (CRUD)
//
// postMessage types and request field names in this package
// are clone-fidelity-critical. See CLAUDE.md "核心约束".

export * from './assets.js';
export * from './chat.js';
export * from './chats.js';
export * from './comments.js';
export * from './files.js';
export * from './files-copy.js';
export * from './files-grep.js';
export * from './messages.js';
export * from './projects.js';
