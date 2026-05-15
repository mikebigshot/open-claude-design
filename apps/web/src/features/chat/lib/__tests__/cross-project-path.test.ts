import { describe, expect, it } from 'vitest';
import { resolveCrossProjectPath } from '../cross-project-path.js';

describe('resolveCrossProjectPath', () => {
  it('returns the default project for plain relative paths', () => {
    expect(resolveCrossProjectPath('proj-A', 'src/app.tsx')).toEqual({
      projectId: 'proj-A',
      relPath: 'src/app.tsx',
      crossProject: false,
    });
  });

  it('strips a leading slash on plain paths (still default project)', () => {
    expect(resolveCrossProjectPath('proj-A', '/src/app.tsx')).toEqual({
      projectId: 'proj-A',
      relPath: 'src/app.tsx',
      crossProject: false,
    });
  });

  it('routes /projects/<id>/<rel> to the named project', () => {
    expect(resolveCrossProjectPath('proj-A', '/projects/proj-B/src/x.ts')).toEqual({
      projectId: 'proj-B',
      relPath: 'src/x.ts',
      crossProject: true,
    });
  });

  it('handles deep cross-project paths (nested dirs)', () => {
    expect(resolveCrossProjectPath('A', '/projects/B/a/b/c/file.md')).toEqual({
      projectId: 'B',
      relPath: 'a/b/c/file.md',
      crossProject: true,
    });
  });

  it('is case-insensitive on the literal /projects/ prefix', () => {
    expect(resolveCrossProjectPath('A', '/Projects/B/x.ts').crossProject).toBe(true);
    expect(resolveCrossProjectPath('A', '/PROJECTS/B/x.ts').crossProject).toBe(true);
  });

  it('rejects malformed prefixes (empty id, empty rel)', () => {
    // No trailing rel: treat as default-project relative.
    expect(resolveCrossProjectPath('A', '/projects/B').crossProject).toBe(false);
    expect(resolveCrossProjectPath('A', '/projects/B/').crossProject).toBe(false);
    // Empty project id segment.
    expect(resolveCrossProjectPath('A', '/projects//x.ts').crossProject).toBe(false);
  });

  it('strips collapsing slashes on the cross-project rel', () => {
    expect(resolveCrossProjectPath('A', '/projects/B//x.ts')).toEqual({
      projectId: 'B',
      relPath: 'x.ts',
      crossProject: true,
    });
  });
});
