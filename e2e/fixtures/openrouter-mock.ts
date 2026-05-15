// Mock OpenRouter chat completions endpoint.
//
// Vercel AI SDK v6 通过 @openrouter/ai-sdk-provider 直接打 OpenRouter 的
// /api/v1/chat/completions（OpenAI-compatible）。我们在 page level 拦
// 这个 host，伪造一段 SSE response：
//
//   data: <chunk1>\n\n
//   data: <chunk2>\n\n
//   ...
//   data: [DONE]\n\n
//
// 每个 chunk 是 OpenAI Chat Completions Streaming 格式（参考
// https://platform.openai.com/docs/api-reference/chat-streaming/streaming）：
//
//   {
//     id: string,
//     object: "chat.completion.chunk",
//     created: number (unix seconds),
//     model: string,
//     choices: [{
//       index: number,
//       delta: { role?, content?, tool_calls? },
//       finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
//     }],
//     system_fingerprint?: string,
//     usage?: { prompt_tokens, completion_tokens, total_tokens }
//   }
//
// emit 顺序：
//   1. role assistant
//   2. content delta(s)（可选）
//   3. tool_call delta(s)（可选）—— 函数调用增量（function.arguments 可分多 chunk）
//   4. finish_reason chunk
//   5. data: [DONE]
//
// SDK 看到 finish_reason=tool_calls 之后会执行我们注册的 tool execute（即
// apps/web/src/features/chat/tools/write-file.ts execute），写完再回灌新一轮
// chat.completions 请求 — 这次我们 emit 文本 + done() tool_calls 终止。
//
// ────────────────────────────────────────────────────────────────────────────
// chunk shape 不再靠经验或 TODO 注释守护 ——
// 下面的 zod schema 是 source of truth，每一个 chunk 在写出前 .parse() 一次，
// 校验不通过直接 throw（开发期 fail loud）。
// ────────────────────────────────────────────────────────────────────────────

import type { Page, Route } from '@playwright/test';
import { z } from 'zod';

// ───────── zod schemas (source of truth for OpenAI Chat Completions chunk) ─────────

const toolCallFunctionSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
});

const toolCallDeltaSchema = z.object({
  index: z.number().int().min(0),
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: toolCallFunctionSchema.optional(),
});

const chatCompletionChunkChoiceDeltaSchema = z
  .object({
    role: z.literal('assistant').optional(),
    content: z.string().optional(),
    tool_calls: z.array(toolCallDeltaSchema).optional(),
    refusal: z.string().nullable().optional(),
  })
  .strict();

const finishReasonSchema = z
  .enum(['stop', 'tool_calls', 'length', 'content_filter', 'function_call'])
  .nullable();

const chatCompletionChunkChoiceSchema = z.object({
  index: z.number().int().min(0),
  delta: chatCompletionChunkChoiceDeltaSchema,
  finish_reason: finishReasonSchema,
});

const usageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  })
  .partial();

export const chatCompletionChunkSchema = z.object({
  id: z.string().min(1),
  object: z.literal('chat.completion.chunk'),
  created: z.number().int().nonnegative(),
  model: z.string().min(1),
  choices: z.array(chatCompletionChunkChoiceSchema).min(1),
  system_fingerprint: z.string().optional(),
  usage: usageSchema.optional(),
});

export type ChatCompletionChunk = z.infer<typeof chatCompletionChunkSchema>;

// ───────── public types ─────────

export interface MockToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface MockTurn {
  /** 文本块（assistant 思考输出）。可以为空数组。 */
  text?: string;
  /** 这一轮要触发的 tool calls。SDK 看到 finish_reason=tool_calls 就执行。 */
  toolCalls?: MockToolCall[];
  /** 终结这一轮的 finish_reason。tool_calls / stop。 */
  finishReason?: 'tool_calls' | 'stop';
}

export interface MockOpenRouterOptions {
  /**
   * 每次 OpenRouter 请求按顺序返回的回合。SDK 会循环：
   *   request 1 → turns[0]
   *   tool execute → request 2 → turns[1]
   *   ...
   * 用完 turns 后兜底返回一个 stop 回合，避免 SDK 卡住。
   */
  turns?: MockTurn[];
  /**
   * Optional second queue consumed instead of `turns` when the incoming
   * request body contains the FORK_BOUNDARY_PROMPT marker (`=== FORK
   * BOUNDARY ===`). This separates main-agent OpenRouter requests from
   * verifier sub-agent OpenRouter requests so tests can script each
   * independently. Used by verifier-fork.spec.ts.
   */
  verifierTurns?: MockTurn[];
  /**
   * 简化模式：直接给出文件列表 + 是否 done。会自动展开为：
   *   turn1: 一句文本 + 一组 write_file tool calls
   *   turn2: 一句 "Done." + done() tool call
   */
  artifactFiles?: Array<{ path: string; content: string; asset?: string }>;
  /** simplified 模式开启时是否在最后一轮调 done()。默认 true。 */
  finishWithDone?: boolean;

  // ───── error-injection knobs (used by error-paths spec) ─────

  /**
   * 直接覆盖 status / 返回 JSON body —— 不走 SSE。用来模拟 4xx / 5xx。
   * 设了之后 turns / artifactFiles / streamSlowMs / cutMidStream 都被忽略。
   */
  overrideStatus?: number;
  /** overrideStatus 配套的响应 body（JSON）。默认 `{ error: { message: 'mock error' } }`. */
  overrideBody?: unknown;
  /** 每个 chunk 写出之间 sleep 毫秒数。慢流测试 abort 用。 */
  streamSlowMs?: number;
  /** 写 N 个 chunk 后立即 close response，不发 [DONE] —— 模拟中途断流。 */
  cutAfterChunks?: number;
}

// ───────── chunk builders ─────────

let chunkSeq = 0;
function makeChunkId(): string {
  chunkSeq += 1;
  return `chatcmpl-mock-${Date.now()}-${chunkSeq}`;
}

/**
 * 拼一个 chunk 并验 shape；不通过抛错。永远走这个出口才能保证
 * 我们 mock 的输出严格符合 OpenAI 协议。
 */
function makeChunk(
  delta: z.infer<typeof chatCompletionChunkChoiceDeltaSchema>,
  opts: { finishReason?: z.infer<typeof finishReasonSchema>; id: string },
): string {
  const obj: ChatCompletionChunk = {
    id: opts.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'anthropic/claude-sonnet-4-5',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: opts.finishReason ?? null,
      },
    ],
  };
  // 校验 —— 不通过直接 throw（fail loud）
  chatCompletionChunkSchema.parse(obj);
  return 'data: ' + JSON.stringify(obj) + '\n\n';
}

function turnToChunks(turn: MockTurn): string[] {
  const id = makeChunkId();
  const lines: string[] = [];

  // role chunk
  lines.push(makeChunk({ role: 'assistant' }, { id }));

  if (turn.text) {
    lines.push(makeChunk({ content: turn.text }, { id }));
  }

  if (turn.toolCalls && turn.toolCalls.length > 0) {
    turn.toolCalls.forEach((tc, idx) => {
      lines.push(
        makeChunk(
          {
            tool_calls: [
              {
                index: idx,
                id: `call_mock_${idx}_${Date.now()}`,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                },
              },
            ],
          },
          { id },
        ),
      );
    });
  }

  // finish_reason chunk —— delta 必须留空（schema 严格不允许多余字段，{} 通过 strict）
  const finishReason: z.infer<typeof finishReasonSchema> =
    turn.finishReason ?? (turn.toolCalls && turn.toolCalls.length > 0 ? 'tool_calls' : 'stop');
  lines.push(makeChunk({}, { id, finishReason }));
  return lines;
}

function expandSimplified(opts: MockOpenRouterOptions): MockTurn[] {
  if (!opts.artifactFiles || opts.artifactFiles.length === 0) {
    return [{ text: 'Hello from mock', finishReason: 'stop' }];
  }
  const writeCalls: MockToolCall[] = opts.artifactFiles.map((f) => ({
    name: 'write_file',
    args: {
      path: f.path,
      content: f.content,
      ...(f.asset !== undefined ? { asset: f.asset } : {}),
    },
  }));
  const turns: MockTurn[] = [
    {
      text: "I'll create the requested files.",
      toolCalls: writeCalls,
      finishReason: 'tool_calls',
    },
  ];
  if (opts.finishWithDone !== false) {
    turns.push({
      text: 'Files created.',
      toolCalls: [{ name: 'done', args: { summary: 'Files created.' } }],
      finishReason: 'tool_calls',
    });
    turns.push({ text: 'All done.', finishReason: 'stop' });
  } else {
    turns.push({ text: 'Files created.', finishReason: 'stop' });
  }
  return turns;
}

// ───────── route handler ─────────

export async function mockOpenRouter(
  page: Page,
  options: MockOpenRouterOptions = {},
): Promise<void> {
  const mainTurns: MockTurn[] = options.turns ?? expandSimplified(options);
  const verifierTurns: MockTurn[] = options.verifierTurns ?? [];
  let mainCount = 0;
  let verifierCount = 0;

  await page.route('**/openrouter.ai/api/v1/chat/completions*', async (route: Route) => {
    // ───── error injection: status override ─────
    if (typeof options.overrideStatus === 'number') {
      const status = options.overrideStatus;
      const body =
        options.overrideBody !== undefined
          ? options.overrideBody
          : { error: { message: `mock ${status}`, type: 'mock_error' } };
      await route.fulfill({
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return;
    }

    // Differentiate main vs verifier by request body marker. Verifier's
    // triggering user message is FORK_BOUNDARY_PROMPT which starts with
    // `=== FORK BOUNDARY ===` — that string only appears in verifier
    // sub-chat requests.
    const requestBody = route.request().postData() ?? '';
    const isVerifierRequest = requestBody.includes('=== FORK BOUNDARY ===');

    let turn: MockTurn;
    if (isVerifierRequest && verifierTurns.length > 0) {
      turn =
        verifierTurns[verifierCount] ?? {
          text: 'Verifier: no more mock turns — bailing out.',
          finishReason: 'stop',
        };
      verifierCount += 1;
    } else {
      turn =
        mainTurns[mainCount] ?? {
          text: 'No more mock turns — bailing out.',
          finishReason: 'stop',
        };
      mainCount += 1;
    }

    // ───── slow / cut: stream chunks one by one through Playwright fulfill won't
    // work (route.fulfill 是一次性 buffer)。改用 page.context().request 拦不行;
    // 真要做慢流要走 route.continue() + 自己 server。
    // 这里 best-effort：拼好 body 再发，若有 streamSlowMs 在每个 chunk 之间
    // 加微小 delay；cutAfterChunks 截断 chunks 数组（不发 [DONE]）。
    // ─────
    const allChunks = turnToChunks(turn);
    const finalChunks =
      typeof options.cutAfterChunks === 'number'
        ? allChunks.slice(0, options.cutAfterChunks)
        : allChunks;

    let body = finalChunks.join('');
    if (typeof options.cutAfterChunks !== 'number') {
      body += 'data: [DONE]\n\n';
    }

    if (typeof options.streamSlowMs === 'number' && options.streamSlowMs > 0) {
      // route.fulfill 一次性发完没法真的 chunk-stream。下面这个 sleep 模拟
      // 整体响应延迟（够长就能让测试 click Stop 在响应到达之前），是 abort
      // 测试需要的最小可行近似。
      await new Promise<void>((resolve) => setTimeout(resolve, options.streamSlowMs));
    }

    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      },
      body,
    });
  });
}
