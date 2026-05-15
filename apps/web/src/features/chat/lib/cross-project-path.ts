// cross-project-path — resolve the `/projects/<id>/<rel>` prefix used by
// read_file / list_files / copy_files / grep / view_image / write_file when
// the agent needs to reach into a project other than the current one.
//
// Plain paths (no `/projects/` prefix) stay in the current project.

export interface CrossProjectRef {
  /** Target project — caller's default unless the path was prefixed. */
  projectId: string;
  /** Project-relative path with no leading `/`. */
  relPath: string;
  /** True when the input carried an explicit `/projects/<id>/` prefix. */
  crossProject: boolean;
}

/**
 * Parse an optional `/projects/<projectId>/<rel>` prefix from `path`. If the
 * prefix is present and well-formed (non-empty project id + non-empty rel),
 * route the request at that project. Otherwise route at `defaultProjectId`.
 *
 * Notes
 * - The prefix is case-insensitive on the literal `/projects/` segment so
 *   `/Projects/<id>/foo.ts` resolves the same way (forgive accidental case).
 * - A leading `/` outside the cross-project prefix is treated as project-
 *   relative (stripped) so `/src/x.ts` reads `src/x.ts` in the default
 *   project — matches existing tool behavior.
 * - A bare `/projects/<id>` (no trailing slash + rel) does NOT trigger
 *   cross-project routing; it's treated as a relative path in the default
 *   project (the caller likely meant a directory list, which uses
 *   `list_files` with a separate path).
 */
export function resolveCrossProjectPath(
  defaultProjectId: string,
  path: string,
): CrossProjectRef {
  if (/^\/projects\//i.test(path)) {
    const after = path.slice('/projects/'.length);
    const slash = after.indexOf('/');
    if (slash > 0) {
      const projectId = after.slice(0, slash).trim();
      const relPath = after.slice(slash + 1).replace(/^\/+/, '');
      if (projectId.length > 0 && relPath.length > 0) {
        return { projectId, relPath, crossProject: true };
      }
    }
  }
  // Plain path — strip any spurious leading slash, route at default project.
  return {
    projectId: defaultProjectId,
    relPath: path.replace(/^\/+/, ''),
    crossProject: false,
  };
}
