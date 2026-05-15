// Test-only helper: AI SDK 6 types `tool.inputSchema` as `FlexibleSchema<T>`
// which doesn't expose `safeParse` to TypeScript. At runtime it IS a Zod
// schema (because that's what we pass to `tool({...})`), so `safeParse`
// works. This helper casts through `unknown` to a minimal interface so the
// tests can assert schema validation without `// @ts-expect-error`.

export interface ParseableSchema {
  safeParse: (input: unknown) => { success: boolean };
}

export function asSchema(s: unknown): ParseableSchema | undefined {
  return s as ParseableSchema | undefined;
}
