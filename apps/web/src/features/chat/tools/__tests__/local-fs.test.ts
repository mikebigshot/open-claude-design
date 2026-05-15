// local_* — File System Access bridge stubs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  localCopyToProjectTool,
  localGrepTool,
  localLsTool,
  localReadTool,
} from '../local-fs';
import { _setMountedDirectory } from '@/lib/local-mounts';
import { asSchema } from './_schema-helpers';

const ctx = { toolCallId: 't1', messages: [], abortSignal: new AbortController().signal };

const originalPicker = (window as unknown as Record<string, unknown>).showDirectoryPicker;

afterEach(() => {
  _setMountedDirectory(null);
  if (originalPicker === undefined) {
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  } else {
    (window as unknown as Record<string, unknown>).showDirectoryPicker = originalPicker;
  }
});

beforeEach(() => {
  _setMountedDirectory(null);
});

describe('local_* tools', () => {
  describe('preflight: no File System Access API', () => {
    beforeEach(() => {
      delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
    });

    it('local_ls returns the not-supported error', async () => {
      const r = (await localLsTool().execute!({}, ctx)) as string;
      expect(r).toMatch(/error/i);
      expect(r).toMatch(/File System Access API/);
    });

    it('local_read / local_grep / local_copy all return the same message', async () => {
      const r1 = (await localReadTool().execute!({ path: 'a' }, ctx)) as string;
      const r2 = (await localGrepTool().execute!({ pattern: 'x' }, ctx)) as string;
      const r3 = (await localCopyToProjectTool('p').execute!(
        { from: 'a', to: 'b' },
        ctx,
      )) as string;
      for (const r of [r1, r2, r3]) {
        expect(r).toMatch(/File System Access API/);
      }
    });
  });

  describe('preflight: API available but no mount', () => {
    beforeEach(() => {
      (window as unknown as Record<string, unknown>).showDirectoryPicker = () => {
        throw new Error('not implemented');
      };
    });

    it('local_ls returns the no-mount-registered error', async () => {
      const r = (await localLsTool().execute!({}, ctx)) as string;
      expect(r).toMatch(/no local directory mounted|no mount/i);
    });
  });

  describe('schema', () => {
    it('local_ls accepts empty input and optional path', () => {
      const t = localLsTool();
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(true);
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'src' }).success).toBe(true);
    });

    it('local_read requires path', () => {
      const t = localReadTool();
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({ path: 'a.txt' }).success).toBe(true);
    });

    it('local_grep requires pattern', () => {
      const t = localGrepTool();
      expect(asSchema(t.inputSchema)?.safeParse({}).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({ pattern: 'foo' }).success).toBe(true);
    });

    it('local_copy_to_project requires from + to', () => {
      const t = localCopyToProjectTool('p');
      expect(asSchema(t.inputSchema)?.safeParse({ from: 'a' }).success).toBe(false);
      expect(asSchema(t.inputSchema)?.safeParse({ from: 'a', to: 'b' }).success).toBe(true);
    });
  });

  // ── Behavior with a mounted (fake) FileSystemDirectoryHandle ──
  describe('behavior with a mounted directory', () => {
    interface FakeFile {
      kind: 'file';
      name: string;
      bytes: Uint8Array;
      type?: string;
    }
    interface FakeDir {
      kind: 'directory';
      name: string;
      _entries: Array<[string, FakeFile | FakeDir]>;
    }
    function file(name: string, text: string, type = 'text/plain'): FakeFile {
      return { kind: 'file', name, bytes: new TextEncoder().encode(text), type };
    }
    function dir(name: string, ...entries: Array<FakeFile | FakeDir>): FakeDir {
      return {
        kind: 'directory',
        name,
        _entries: entries.map((e) => [e.name, e]),
      };
    }
    function asFsHandle(node: FakeFile | FakeDir): unknown {
      if (node.kind === 'file') {
        return {
          kind: 'file',
          name: node.name,
          getFile: async () => ({
            text: async () => new TextDecoder().decode(node.bytes),
            arrayBuffer: async () => new Uint8Array(node.bytes).buffer,
            size: node.bytes.byteLength,
            type: node.type ?? '',
            name: node.name,
          }),
        };
      }
      return {
        kind: 'directory',
        name: node.name,
        _entries: node._entries.map(([n, h]) => [n, asFsHandle(h)]),
        getFileHandle: async (name: string) => {
          const found = node._entries.find(([n]) => n === name);
          if (!found || found[1].kind !== 'file') throw new Error('not a file');
          return asFsHandle(found[1]);
        },
        getDirectoryHandle: async (name: string) => {
          const found = node._entries.find(([n]) => n === name);
          if (!found || found[1].kind !== 'directory') throw new Error('not a directory');
          return asFsHandle(found[1]);
        },
      };
    }

    beforeEach(() => {
      (window as unknown as Record<string, unknown>).showDirectoryPicker = () => {
        throw new Error('not implemented');
      };
    });

    it('local_ls lists files and directories at the mount root', async () => {
      const root = dir(
        '/',
        file('README.md', '# proj'),
        dir('src', file('app.ts', 'export const x = 1;')),
      );
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localLsTool().execute!({}, ctx)) as string;
      expect(r).toContain('📄 README.md');
      expect(r).toContain('📁 src/');
    });

    it('local_ls walks into a sub-directory by path', async () => {
      const root = dir(
        '/',
        dir(
          'src',
          file('app.ts', 'export const x = 1;'),
          dir('components', file('Btn.tsx', 'export const Btn = () => null;')),
        ),
      );
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localLsTool().execute!({ path: 'src' }, ctx)) as string;
      expect(r).toContain('📄 app.ts');
      expect(r).toContain('📁 components/');
      const r2 = (await localLsTool().execute!({ path: 'src/components' }, ctx)) as string;
      expect(r2).toContain('📄 Btn.tsx');
    });

    it('local_ls returns not-found for a missing path', async () => {
      const root = dir('/', file('a.txt', 'a'));
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localLsTool().execute!({ path: 'missing' }, ctx)) as string;
      expect(r).toMatch(/not found/i);
    });

    it('local_read returns formatted file content', async () => {
      const root = dir('/', file('greet.txt', 'hello\nworld\n'));
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localReadTool().execute!({ path: 'greet.txt' }, ctx)) as string;
      expect(r).toContain('[Local: greet.txt]');
      expect(r).toContain('hello');
      expect(r).toContain('world');
    });

    it('local_read offset/limit slices the content', async () => {
      const root = dir('/', file('long.txt', Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')));
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localReadTool().execute!(
        { path: 'long.txt', offset: 3, limit: 2 },
        ctx,
      )) as string;
      expect(r).toContain('line3');
      expect(r).toContain('line4');
      expect(r).not.toContain('line5');
      expect(r).not.toContain('line2');
    });

    it('local_grep finds matches across the mount and reports path:line', async () => {
      const root = dir(
        '/',
        file('a.txt', 'hello world\nfoo bar\n'),
        dir('sub', file('b.txt', 'another line\nFOO\nfoo again\n')),
      );
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localGrepTool().execute!({ pattern: 'foo' }, ctx)) as string;
      expect(r).toContain('a.txt:2:');
      expect(r).toContain('sub/b.txt:3:');
      // Case-sensitive by default (default regex behavior).
      expect(r).not.toContain('sub/b.txt:2:');
    });

    it('local_grep skips binary-extension files', async () => {
      const root = dir(
        '/',
        file('logo.png', 'this contains the word match'),
        file('readme.txt', 'this also has match'),
      );
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      const r = (await localGrepTool().execute!({ pattern: 'match' }, ctx)) as string;
      expect(r).toContain('readme.txt');
      expect(r).not.toContain('logo.png');
    });

    it('local_copy_to_project reads the source bytes and PUTs them to the worker', async () => {
      const root = dir('/', file('hero.css', '.hero { color: red; }', 'text/css'));
      _setMountedDirectory(asFsHandle(root) as FileSystemDirectoryHandle);
      let putCall: { url: string; mime?: string | null; bodyLen: number } | null = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const ct = init?.headers ? (init.headers as Record<string, string>)['content-type'] : null;
        const bodyLen =
          init?.body instanceof ArrayBuffer
            ? init.body.byteLength
            : typeof init?.body === 'string'
              ? (init.body as string).length
              : 0;
        putCall = { url, mime: ct, bodyLen };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;
      const r = (await localCopyToProjectTool('proj-A').execute!(
        { from: 'hero.css', to: 'assets/hero.css' },
        ctx,
      )) as string;
      expect(r).toMatch(/Copied hero\.css → assets\/hero\.css/);
      expect(putCall).not.toBeNull();
      expect(putCall!.url).toContain('/api/projects/proj-A/files/assets/hero.css');
      expect(putCall!.mime).toBe('text/css');
      expect(putCall!.bodyLen).toBeGreaterThan(0);
    });
  });
});
