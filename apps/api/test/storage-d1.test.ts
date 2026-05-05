import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated } from './helpers/miniflare-env.js';
import {
  createProject,
  deleteChat,
  deleteComment,
  deleteProject,
  getBlobRow,
  getChat,
  getFileRow,
  getProject,
  insertChat,
  insertComment,
  listChats,
  listComments,
  listFiles,
  listMessages,
  listProjects,
  patchChat,
  replaceMessages,
  touchChat,
  touchProject,
  updateProject,
  upsertBlobRow,
  upsertFileRow,
} from '../src/storage/d1.js';
import type { CreateProjectRequest } from '@open-design/contracts';

// Unit tests for src/storage/d1.ts. Uses the real miniflare D1 binding (env.DB)
// rather than mocks — same pattern as routes integration tests, mirroring
// production wire shape and SQLite quirks.
//
// State persists across tests (`isolatedStorage: false`); use unique ids to
// avoid leakage between cases.

const DB = () => env.DB;

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${crypto.randomUUID()}`;
}

const SHA64 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function makeCreateInput(overrides: Partial<CreateProjectRequest> = {}): CreateProjectRequest {
  return {
    name: 'Test',
    type: 'prototype',
    fidelity: 'wireframe',
    ...overrides,
  };
}

function fakeSha(label: string): string {
  const hex = Array.from(label)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return (hex + 'a'.repeat(64)).slice(0, 64);
}

describe('storage/d1', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  // ---------------------------------------------------------------------------
  // createProject / getProject
  // ---------------------------------------------------------------------------

  describe('createProject', () => {
    it('inserts and returns a Project with a generated UUID', async () => {
      const p = await createProject(DB(), makeCreateInput({ name: uniq('create') }));
      expect(p.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(p.name.startsWith('create-')).toBe(true);
      expect(p.type).toBe('prototype');
      expect(p.fidelity).toBe('wireframe');
      expect(p.designSystemId).toBeNull();
      expect(p.createdAt).toMatch(ISO_DATE);
      expect(p.updatedAt).toBe(p.createdAt);
    });

    it('persists designSystemId when provided', async () => {
      const p = await createProject(
        DB(),
        makeCreateInput({ name: uniq('with-ds'), designSystemId: 'ds-foo' }),
      );
      expect(p.designSystemId).toBe('ds-foo');

      const fetched = await getProject(DB(), p.id);
      expect(fetched?.designSystemId).toBe('ds-foo');
    });

    it('coerces undefined designSystemId to null', async () => {
      const p = await createProject(DB(), makeCreateInput({ name: uniq('no-ds') }));
      expect(p.designSystemId).toBeNull();

      const fetched = await getProject(DB(), p.id);
      expect(fetched?.designSystemId).toBeNull();
    });
  });

  describe('getProject', () => {
    it('returns null for unknown id', async () => {
      const got = await getProject(DB(), 'nope-' + crypto.randomUUID());
      expect(got).toBeNull();
    });

    it('returns the row that createProject inserted', async () => {
      const created = await createProject(DB(), makeCreateInput({ name: uniq('get') }));
      const fetched = await getProject(DB(), created.id);
      expect(fetched).toEqual(created);
    });
  });

  // ---------------------------------------------------------------------------
  // listProjects
  // ---------------------------------------------------------------------------

  describe('listProjects', () => {
    it('orders by updated_at DESC', async () => {
      const older = await createProject(DB(), makeCreateInput({ name: uniq('list-older') }));
      // Force distinct ms timestamp.
      await new Promise((r) => setTimeout(r, 10));
      const newer = await createProject(DB(), makeCreateInput({ name: uniq('list-newer') }));

      const all = await listProjects(DB(), 100, 0);
      const idx = (id: string) => all.findIndex((p) => p.id === id);
      expect(idx(newer.id)).toBeGreaterThanOrEqual(0);
      expect(idx(older.id)).toBeGreaterThanOrEqual(0);
      // newer must come first (smaller index)
      expect(idx(newer.id)).toBeLessThan(idx(older.id));
    });

    it('respects limit', async () => {
      const list = await listProjects(DB(), 1, 0);
      expect(list.length).toBeLessThanOrEqual(1);
    });

    it('respects offset', async () => {
      const all = await listProjects(DB(), 100, 0);
      const offsetOne = await listProjects(DB(), 100, 1);
      // Offset of 1 means we skip the first row.
      expect(offsetOne.length).toBe(Math.max(0, all.length - 1));
      if (all.length > 1) {
        expect(offsetOne[0]?.id).toBe(all[1]?.id);
      }
    });

    it('uses default limit=20 / offset=0 when not specified', async () => {
      const out = await listProjects(DB());
      expect(out.length).toBeLessThanOrEqual(20);
    });
  });

  // ---------------------------------------------------------------------------
  // updateProject
  // ---------------------------------------------------------------------------

  describe('updateProject', () => {
    it('updates name and bumps updated_at', async () => {
      const p = await createProject(DB(), makeCreateInput({ name: 'before' }));
      // Tiny delay so updated_at differs.
      await new Promise((r) => setTimeout(r, 10));
      const updated = await updateProject(DB(), p.id, { name: 'after' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('after');
      expect(updated!.updatedAt > p.updatedAt).toBe(true);
      // createdAt unchanged.
      expect(updated!.createdAt).toBe(p.createdAt);
    });

    it('returns the existing project untouched when patch.name is undefined', async () => {
      const p = await createProject(DB(), makeCreateInput({ name: uniq('no-op-update') }));
      const result = await updateProject(DB(), p.id, {});
      expect(result).toEqual(p);
    });

    it('returns null for unknown id', async () => {
      const got = await updateProject(DB(), 'nonexistent-' + crypto.randomUUID(), {
        name: 'whatever',
      });
      expect(got).toBeNull();
    });

    it('returns null for unknown id even when patch is empty (no-name path)', async () => {
      // When patch.name is undefined, updateProject delegates to getProject.
      // Unknown id → getProject returns null → updateProject also returns null.
      const got = await updateProject(DB(), 'nonexistent-' + crypto.randomUUID(), {});
      expect(got).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // deleteProject
  // ---------------------------------------------------------------------------

  describe('deleteProject', () => {
    it('returns true and removes the row', async () => {
      const p = await createProject(DB(), makeCreateInput({ name: uniq('delete') }));
      const ok = await deleteProject(DB(), p.id);
      expect(ok).toBe(true);
      expect(await getProject(DB(), p.id)).toBeNull();
    });

    it('returns false for unknown id', async () => {
      const ok = await deleteProject(DB(), 'unknown-' + crypto.randomUUID());
      expect(ok).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // touchProject
  // ---------------------------------------------------------------------------

  describe('touchProject', () => {
    it('bumps updated_at without changing other fields', async () => {
      const p = await createProject(DB(), makeCreateInput({ name: uniq('touch') }));
      await new Promise((r) => setTimeout(r, 10));
      await touchProject(DB(), p.id);
      const after = await getProject(DB(), p.id);
      expect(after!.updatedAt > p.updatedAt).toBe(true);
      expect(after!.name).toBe(p.name);
      expect(after!.createdAt).toBe(p.createdAt);
    });

    it('is a no-op for unknown id (no throw)', async () => {
      // touchProject doesn't return a value or throw on missing row — verify it doesn't throw.
      await expect(
        touchProject(DB(), 'nonexistent-' + crypto.randomUUID()),
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // blobs: getBlobRow / upsertBlobRow
  // ---------------------------------------------------------------------------

  describe('upsertBlobRow + getBlobRow', () => {
    it('returns null before insert', async () => {
      const sha = fakeSha(uniq('blob-miss'));
      expect(await getBlobRow(DB(), sha)).toBeNull();
    });

    it('inserts and returns row with size + mime', async () => {
      const sha = fakeSha(uniq('blob-hit'));
      await upsertBlobRow(DB(), sha, 'text/plain', 17);
      const row = await getBlobRow(DB(), sha);
      expect(row).not.toBeNull();
      expect(row!.sha256).toBe(sha);
      expect(row!.mime_type).toBe('text/plain');
      expect(row!.size).toBe(17);
      expect(row!.created_at).toMatch(ISO_DATE);
    });

    it('ON CONFLICT DO NOTHING: second upsert with different mime/size keeps original', async () => {
      const sha = fakeSha(uniq('blob-conflict'));
      await upsertBlobRow(DB(), sha, 'text/plain', 10);
      const before = await getBlobRow(DB(), sha);
      // Re-insert with different metadata — should be ignored (DO NOTHING).
      await upsertBlobRow(DB(), sha, 'image/png', 999999);
      const after = await getBlobRow(DB(), sha);
      expect(after!.mime_type).toBe('text/plain');
      expect(after!.size).toBe(10);
      expect(after!.created_at).toBe(before!.created_at);
    });
  });

  // ---------------------------------------------------------------------------
  // files: listFiles / getFileRow / upsertFileRow
  // ---------------------------------------------------------------------------

  describe('upsertFileRow + listFiles + getFileRow', () => {
    it('first insert returns version 1', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-v1') }));
      const sha = fakeSha(uniq('v1-sha'));
      await upsertBlobRow(DB(), sha, 'text/jsx', 10);
      const v1 = await upsertFileRow(DB(), project.id, 'App.jsx', sha);
      expect(v1).toBe(1);
    });

    it('subsequent upsert with same path bumps version monotonically', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-bump') }));
      const sha1 = fakeSha(uniq('bump-1'));
      const sha2 = fakeSha(uniq('bump-2'));
      await upsertBlobRow(DB(), sha1, 'text/jsx', 5);
      await upsertBlobRow(DB(), sha2, 'text/jsx', 6);
      const v1 = await upsertFileRow(DB(), project.id, 'X.jsx', sha1);
      const v2 = await upsertFileRow(DB(), project.id, 'X.jsx', sha2);
      const v3 = await upsertFileRow(DB(), project.id, 'X.jsx', sha2); // same content again
      expect(v1).toBe(1);
      expect(v2).toBe(2);
      expect(v3).toBe(3);
    });

    it('different paths in same project track versions independently', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-iso') }));
      const shaA = fakeSha(uniq('iso-a'));
      const shaB = fakeSha(uniq('iso-b'));
      await upsertBlobRow(DB(), shaA, 'text/plain', 1);
      await upsertBlobRow(DB(), shaB, 'text/plain', 1);
      expect(await upsertFileRow(DB(), project.id, 'a.txt', shaA)).toBe(1);
      expect(await upsertFileRow(DB(), project.id, 'b.txt', shaB)).toBe(1);
      expect(await upsertFileRow(DB(), project.id, 'a.txt', shaB)).toBe(2);
      expect(await upsertFileRow(DB(), project.id, 'b.txt', shaA)).toBe(2);
    });

    it('listFiles returns rows ordered by path ASC', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-list') }));
      const sha = fakeSha(uniq('list-sha'));
      await upsertBlobRow(DB(), sha, 'text/plain', 4);
      await upsertFileRow(DB(), project.id, 'zebra.txt', sha);
      await upsertFileRow(DB(), project.id, 'apple.txt', sha);
      await upsertFileRow(DB(), project.id, 'mango.txt', sha);

      const rows = await listFiles(DB(), project.id);
      const paths = rows.map((r) => r.path);
      expect(paths).toEqual(['apple.txt', 'mango.txt', 'zebra.txt']);
    });

    it('listFiles returns empty array for project with no files', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-empty') }));
      const rows = await listFiles(DB(), project.id);
      expect(rows).toEqual([]);
    });

    it('getFileRow returns joined file+blob row including mime/size', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-join') }));
      const sha = fakeSha(uniq('join-sha'));
      await upsertBlobRow(DB(), sha, 'text/jsx', 42);
      await upsertFileRow(DB(), project.id, 'src/App.jsx', sha);

      const row = await getFileRow(DB(), project.id, 'src/App.jsx');
      expect(row).not.toBeNull();
      expect(row!.path).toBe('src/App.jsx');
      expect(row!.sha256).toBe(sha);
      expect(row!.mime_type).toBe('text/jsx');
      expect(row!.size).toBe(42);
      expect(row!.version).toBe(1);
    });

    it('getFileRow returns null for unknown path', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('files-miss') }));
      const got = await getFileRow(DB(), project.id, 'nope.txt');
      expect(got).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // chats: listChats / insertChat / patchChat / deleteChat / touchChat (Task 2)
  // ---------------------------------------------------------------------------

  describe('chats CRUD', () => {
    it('listChats returns empty for fresh project', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-empty') }));
      expect(await listChats(DB(), project.id)).toEqual([]);
    });

    it('insertChat then listChats / getChat round-trip', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-rt') }));
      const id = uniq('chat-rt');
      const chat = await insertChat(DB(), project.id, { id, title: 'Hello' });
      expect(chat.id).toBe(id);
      expect(chat.title).toBe('Hello');
      expect(chat.projectId).toBe(project.id);

      const list = await listChats(DB(), project.id);
      expect(list.map((c) => c.id)).toEqual([id]);

      const single = await getChat(DB(), project.id, id);
      expect(single?.title).toBe('Hello');
    });

    it('insertChat with same id is idempotent and updates title', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-idem') }));
      const id = uniq('chat-idem');
      await insertChat(DB(), project.id, { id, title: 'A' });
      await insertChat(DB(), project.id, { id, title: 'B' });
      const list = await listChats(DB(), project.id);
      expect(list.length).toBe(1);
      expect(list[0]!.title).toBe('B');
    });

    it('patchChat updates title; null clears it', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-patch') }));
      const id = uniq('chat-patch');
      await insertChat(DB(), project.id, { id, title: 'Old' });
      const patched1 = await patchChat(DB(), project.id, id, { title: 'New' });
      expect(patched1?.title).toBe('New');
      const patched2 = await patchChat(DB(), project.id, id, { title: null });
      expect(patched2?.title).toBeNull();
    });

    it('patchChat returns null for unknown chat', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-pmiss') }));
      const got = await patchChat(DB(), project.id, 'no-such-chat', { title: 'X' });
      expect(got).toBeNull();
    });

    it('deleteChat returns false for unknown chat, true when row removed', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-del') }));
      const id = uniq('chat-del');
      expect(await deleteChat(DB(), project.id, id)).toBe(false);
      await insertChat(DB(), project.id, { id });
      expect(await deleteChat(DB(), project.id, id)).toBe(true);
      expect(await listChats(DB(), project.id)).toEqual([]);
    });

    it('touchChat advances updated_at', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-touch') }));
      const id = uniq('chat-touch');
      const created = await insertChat(DB(), project.id, { id });
      // Sleep ~5ms so ISO timestamps differ at millisecond resolution.
      await new Promise((r) => setTimeout(r, 5));
      await touchChat(DB(), project.id, id);
      const after = await getChat(DB(), project.id, id);
      expect(after?.updatedAt).not.toBe(created.updatedAt);
    });

    it('isolates chats per project', async () => {
      const a = await createProject(DB(), makeCreateInput({ name: uniq('chats-iso-a') }));
      const b = await createProject(DB(), makeCreateInput({ name: uniq('chats-iso-b') }));
      await insertChat(DB(), a.id, { id: uniq('a-1') });
      await insertChat(DB(), b.id, { id: uniq('b-1') });
      await insertChat(DB(), b.id, { id: uniq('b-2') });
      expect((await listChats(DB(), a.id)).length).toBe(1);
      expect((await listChats(DB(), b.id)).length).toBe(2);
    });

    it('deleteProject cascades chats', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('chats-cascp') }));
      await insertChat(DB(), project.id, { id: uniq('child-1') });
      await insertChat(DB(), project.id, { id: uniq('child-2') });
      await deleteProject(DB(), project.id);
      // Recreate fresh — no chats survive; FK CASCADE wiped them.
      const fresh = await createProject(DB(), makeCreateInput({ name: uniq('chats-cascp-2') }));
      expect(await listChats(DB(), fresh.id)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // messages: listMessages / replaceMessages (per-chat, Task 2)
  // ---------------------------------------------------------------------------

  describe('replaceMessages + listMessages', () => {
    /** Helper: create project + chat in one go. */
    async function createProjectAndChat(name: string) {
      const project = await createProject(DB(), makeCreateInput({ name }));
      const chatId = uniq('chat-' + name);
      await insertChat(DB(), project.id, { id: chatId });
      return { project, chatId };
    }

    it('listMessages returns empty array for fresh chat', async () => {
      const { project, chatId } = await createProjectAndChat(uniq('msg-empty'));
      expect(await listMessages(DB(), project.id, chatId)).toEqual([]);
    });

    it('replaceMessages writes data column verbatim, listMessages JSON.parses it back', async () => {
      const { project, chatId } = await createProjectAndChat(uniq('msg-roundtrip'));
      const id1 = uniq('msg-rt-1');
      const id2 = uniq('msg-rt-2');
      const m1 = { id: id1, role: 'user', parts: [{ type: 'text', text: 'hi' }] };
      const m2 = {
        id: id2,
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: { foo: 'bar' },
      };
      const count = await replaceMessages(DB(), project.id, chatId, [
        { id: m1.id, role: m1.role, data: m1 },
        { id: m2.id, role: m2.role, data: m2 },
      ]);
      expect(count).toBe(2);

      const got = await listMessages(DB(), project.id, chatId);
      expect(got).toEqual([m1, m2]);
    });

    it('preserves position order from input array (no reordering)', async () => {
      const { project, chatId } = await createProjectAndChat(uniq('msg-order'));
      const idZ = uniq('order-z');
      const idA = uniq('order-a');
      const idM = uniq('order-m');
      const messages = [
        { id: idZ, role: 'user', data: { id: idZ, text: 'first' } },
        { id: idA, role: 'assistant', data: { id: idA, text: 'second' } },
        { id: idM, role: 'user', data: { id: idM, text: 'third' } },
      ];
      await replaceMessages(DB(), project.id, chatId, messages);
      const got = await listMessages(DB(), project.id, chatId);
      expect(got).toEqual(messages.map((m) => m.data));
    });

    it('replaceMessages truly REPLACES (deletes old before writing new)', async () => {
      const { project, chatId } = await createProjectAndChat(uniq('msg-replace'));
      const oldId1 = uniq('msg-old-1');
      const oldId2 = uniq('msg-old-2');
      const newId = uniq('msg-new-1');
      await replaceMessages(DB(), project.id, chatId, [
        { id: oldId1, role: 'user', data: { id: oldId1, text: 'old' } },
        { id: oldId2, role: 'user', data: { id: oldId2, text: 'old' } },
      ]);
      await replaceMessages(DB(), project.id, chatId, [
        { id: newId, role: 'user', data: { id: newId, text: 'new' } },
      ]);
      const got = await listMessages(DB(), project.id, chatId);
      expect(got).toHaveLength(1);
      expect(got[0]).toEqual({ id: newId, text: 'new' });
    });

    it('replaceMessages with empty array clears all messages and returns 0', async () => {
      const { project, chatId } = await createProjectAndChat(uniq('msg-clear'));
      const id = uniq('msg-clear-x');
      await replaceMessages(DB(), project.id, chatId, [{ id, role: 'user', data: { id } }]);
      const count = await replaceMessages(DB(), project.id, chatId, []);
      expect(count).toBe(0);
      expect(await listMessages(DB(), project.id, chatId)).toEqual([]);
    });

    it('isolates messages per chat (within same project)', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('msg-iso-chat') }));
      const chatA = uniq('chat-iso-a');
      const chatB = uniq('chat-iso-b');
      await insertChat(DB(), project.id, { id: chatA });
      await insertChat(DB(), project.id, { id: chatB });
      const aId = uniq('msg-iso-a-id');
      const bId = uniq('msg-iso-b-id');
      await replaceMessages(DB(), project.id, chatA, [
        { id: aId, role: 'user', data: { chat: 'a' } },
      ]);
      await replaceMessages(DB(), project.id, chatB, [
        { id: bId, role: 'user', data: { chat: 'b' } },
      ]);
      expect(await listMessages(DB(), project.id, chatA)).toEqual([{ chat: 'a' }]);
      expect(await listMessages(DB(), project.id, chatB)).toEqual([{ chat: 'b' }]);
    });

    it('isolates messages per project', async () => {
      const a = await createProject(DB(), makeCreateInput({ name: uniq('msg-iso-a') }));
      const b = await createProject(DB(), makeCreateInput({ name: uniq('msg-iso-b') }));
      const chatA = uniq('chat-pa');
      const chatB = uniq('chat-pb');
      await insertChat(DB(), a.id, { id: chatA });
      await insertChat(DB(), b.id, { id: chatB });
      const aId = uniq('msg-iso-a-id');
      const bId = uniq('msg-iso-b-id');
      await replaceMessages(DB(), a.id, chatA, [{ id: aId, role: 'user', data: { proj: 'a' } }]);
      await replaceMessages(DB(), b.id, chatB, [{ id: bId, role: 'user', data: { proj: 'b' } }]);
      expect(await listMessages(DB(), a.id, chatA)).toEqual([{ proj: 'a' }]);
      expect(await listMessages(DB(), b.id, chatB)).toEqual([{ proj: 'b' }]);
    });

    // P2-14 regression: PK was on `id` alone, so the same short id (like 'm1')
    // used in two different projects collided with `UNIQUE constraint failed:
    // messages.id`. Composite PK `(project_id, id)` lets ids repeat across
    // projects (each project has its own thread namespace).
    it('allows the same message id across different projects (composite PK)', async () => {
      const a = await createProject(DB(), makeCreateInput({ name: uniq('pk-cross-a') }));
      const b = await createProject(DB(), makeCreateInput({ name: uniq('pk-cross-b') }));
      const chatA = uniq('chat-cross-a');
      const chatB = uniq('chat-cross-b');
      await insertChat(DB(), a.id, { id: chatA });
      await insertChat(DB(), b.id, { id: chatB });
      const sharedId = 'm1';
      await replaceMessages(DB(), a.id, chatA, [
        { id: sharedId, role: 'user', data: { proj: 'a', text: 'hi-a' } },
      ]);
      // Second save with same id under DIFFERENT project must succeed.
      await replaceMessages(DB(), b.id, chatB, [
        { id: sharedId, role: 'user', data: { proj: 'b', text: 'hi-b' } },
      ]);

      const aMsgs = await listMessages(DB(), a.id, chatA);
      const bMsgs = await listMessages(DB(), b.id, chatB);
      expect(aMsgs).toEqual([{ proj: 'a', text: 'hi-a' }]);
      expect(bMsgs).toEqual([{ proj: 'b', text: 'hi-b' }]);
    });

    it('deleteChat cascades its messages', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('msg-casc') }));
      const chatId = uniq('chat-cascade');
      await insertChat(DB(), project.id, { id: chatId });
      const mid = uniq('msg-casc-id');
      await replaceMessages(DB(), project.id, chatId, [
        { id: mid, role: 'user', data: { hello: 1 } },
      ]);
      expect((await listMessages(DB(), project.id, chatId)).length).toBe(1);
      const ok = await deleteChat(DB(), project.id, chatId);
      expect(ok).toBe(true);
      expect((await listMessages(DB(), project.id, chatId)).length).toBe(0);
    });

    it('rejects duplicate message id WITHIN the same project (composite PK still unique per project)', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('pk-same-proj') }));
      // replaceMessages does DELETE then INSERT, so duplicates within a single
      // call would still fail the INSERT half. Verify we don't accidentally
      // allow same-id duplicates inside one thread.
      const sharedId = uniq('dup-in-thread');
      await expect(
        replaceMessages(DB(), project.id, [
          { id: sharedId, role: 'user', data: { n: 1 } },
          { id: sharedId, role: 'assistant', data: { n: 2 } },
        ]),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // comments: insertComment / listComments / deleteComment
  // ---------------------------------------------------------------------------

  describe('insertComment + listComments + deleteComment', () => {
    it('inserts a comment and returns the full Comment shape', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-insert') }));
      const id = uniq('cmt');
      const c = await insertComment(DB(), project.id, {
        id,
        n: 1,
        x: 12.5,
        y: 99,
        text: 'looks good',
        selector: '.header',
        filePath: 'src/App.jsx',
      });
      expect(c.id).toBe(id);
      expect(c.projectId).toBe(project.id);
      expect(c.n).toBe(1);
      expect(c.x).toBe(12.5);
      expect(c.y).toBe(99);
      expect(c.text).toBe('looks good');
      expect(c.selector).toBe('.header');
      expect(c.filePath).toBe('src/App.jsx');
      expect(c.createdAt).toMatch(ISO_DATE);
    });

    it('coerces undefined selector / filePath to null', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-null') }));
      const c = await insertComment(DB(), project.id, {
        id: uniq('cmt-null-id'),
        n: 1,
        x: 0,
        y: 0,
        text: '',
      });
      expect(c.selector).toBeNull();
      expect(c.filePath).toBeNull();
    });

    it('listComments orders by n ascending', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-order') }));
      for (const n of [3, 1, 2]) {
        await insertComment(DB(), project.id, {
          id: uniq(`cmt-order-${n}`),
          n,
          x: 0,
          y: 0,
          text: `pin-${n}`,
        });
      }
      const list = await listComments(DB(), project.id);
      expect(list.map((c) => c.n)).toEqual([1, 2, 3]);
    });

    it('listComments returns empty array for fresh project', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-empty') }));
      expect(await listComments(DB(), project.id)).toEqual([]);
    });

    it('insertComment is idempotent on duplicate id (UPSERT semantics)', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-idem') }));
      const id = uniq('cmt-idem-id');
      await insertComment(DB(), project.id, {
        id,
        n: 1,
        x: 10,
        y: 20,
        text: 'original',
        selector: '.first',
      });
      // Same id → ON CONFLICT branch overwrites.
      await insertComment(DB(), project.id, {
        id,
        n: 5,
        x: 50,
        y: 60,
        text: 'updated',
        selector: '.second',
      });

      const list = await listComments(DB(), project.id);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(id);
      expect(list[0]!.n).toBe(5);
      expect(list[0]!.x).toBe(50);
      expect(list[0]!.y).toBe(60);
      expect(list[0]!.text).toBe('updated');
      expect(list[0]!.selector).toBe('.second');
    });

    it('deleteComment returns true and removes the row', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-del') }));
      const id = uniq('cmt-del-id');
      await insertComment(DB(), project.id, { id, n: 1, x: 0, y: 0, text: 'bye' });
      const ok = await deleteComment(DB(), project.id, id);
      expect(ok).toBe(true);
      expect(await listComments(DB(), project.id)).toEqual([]);
    });

    it('deleteComment returns false for unknown id', async () => {
      const project = await createProject(DB(), makeCreateInput({ name: uniq('cmt-del-miss') }));
      expect(await deleteComment(DB(), project.id, uniq('nonexistent-cmt'))).toBe(false);
    });

    it('deleteComment scoped by projectId (cannot delete across projects)', async () => {
      const a = await createProject(DB(), makeCreateInput({ name: uniq('cmt-scope-a') }));
      const b = await createProject(DB(), makeCreateInput({ name: uniq('cmt-scope-b') }));
      const id = uniq('cmt-scope-id');
      await insertComment(DB(), a.id, { id, n: 1, x: 0, y: 0, text: 'in-a' });

      // Wrong project — should NOT delete.
      const okWrong = await deleteComment(DB(), b.id, id);
      expect(okWrong).toBe(false);

      // Comment still exists under project a.
      const list = await listComments(DB(), a.id);
      expect(list.map((c) => c.id)).toContain(id);
    });
  });
});
