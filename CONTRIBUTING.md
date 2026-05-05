# Contributing to Open Design

Thanks for your interest. This project is in pre-alpha; expect rough edges.

## Development

```bash
# One-time
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars

# Day-to-day
npm run dev       # web (5173) + api (8787) concurrently
npm run build     # production bundle (all packages)
npm run typecheck # tsc --noEmit
npm run lint
npm test
```

## Project structure

An npm workspaces + Turbo monorepo. See [README · Repository layout](README.md#repository-layout).

## Workflow

1. Fork the repo and create a branch off `main` named like `feat/<short-slug>` or `fix/<short-slug>`
2. Make a focused change — one PR per coherent unit of work
3. Run `npm run typecheck && npm run lint && npm test` before pushing
4. Open a PR; CI will run the same checks
5. Address review; squash-merge once approved

## Conventions

- **Commits**: Conventional Commits style (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- **TypeScript**: strict mode is on. Prefer explicit types at module boundaries
- **CSS**: styled-components for app code; CSS variables for tokens shared with the iframe runtime
- **Tests**: Vitest for unit/integration; Playwright for browser-level checks
- **Protocol literals**: `packages/contracts/src/` is the single source of truth for postMessage / SSE / route shapes — don't redefine them ad-hoc in app code

## Reading map for new contributors

If you want to understand the codebase, read in this order:

1. [`README.md`](README.md) — what this project is and how to run it
2. [`CLAUDE.md`](CLAUDE.md) — architecture overview, protocol literals, working conventions
3. [`packages/contracts/src/`](packages/contracts/src/) — wire shapes (the source of truth)
4. [`packages/iframe-runtime/`](packages/iframe-runtime/) — how the in-iframe preview is built (zero runtime deps, pure string assembly)
5. [`apps/web/src/state/types.ts`](apps/web/src/state/types.ts) — frontend reducer action union (extend before adding interactions)
6. [`apps/api/src/`](apps/api/src/) — backend routes, D1 + R2 storage layer

## Code of Conduct

Be kind. Disagreement is fine; disrespect is not. Egregious behavior gets a ban.
