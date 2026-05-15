// Loop helper barrel — pure functions used by ToolLoopAgent / use-agent-chat.
// Each helper is self-contained and unit-tested in isolation. The W1 spec
// (Loop + Protocols) lives in
// internal/docs/superpowers/specs/2026-05-10-agent-v2-alignment-design.md §2.

export {
  estimateMessageTokens,
  estimateTokens,
  type TokenEstimatorMessage,
} from './token-estimator.js';
export {
  ASYNC_PROTOCOL_KEY,
  isAsyncToolResult,
  extractAsyncSpec,
  type AsyncToolResultSpec,
} from './async-dispatch.js';
export {
  IMAGE_REF_KEY,
  isImageRef,
  extractImageRefs,
  toImageContent,
  type ImageRef,
} from './image-ref.js';
export { makePauseGuard, type PauseGuard } from './pause-guard.js';
export {
  TIMEOUT_RETRY_INJECT_TEXT,
  isTimeoutLikeError,
  makeTimeoutRetryHandler,
} from './timeout-retry.js';
export {
  parseSchemaRejectionToolName,
  removeFailingTool,
  makeMcpSchemaRetryHandler,
} from './mcp-schema-retry.js';
export {
  USER_MESSAGE_OPEN,
  USER_MESSAGE_CLOSE,
  wrapPendingUserMessage,
  wrapPendingUserMessages,
} from './user-message-queue.js';
export { applyPendingSnips, type RegisteredSnip } from './snip-applier.js';
export { makeMultiplayerSuffix } from './multiplayer-suffix.js';
export { recoverPartialState } from './abort-recovery.js';
