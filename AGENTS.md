# Agent Instructions

## Required Commands to Run Before Committing

Always run these commands before committing changes:

### 1. Lint (from server directory)
```bash
cd packages/server && yarn lint
```

### 2. Typecheck (from root)
```bash
npx tsc --noEmit -p tsconfig.json
```

### 3. Build (server package for speed)
```bash
yarn workspace server run build
```

## Pre-commit Hook

The pre-commit hook is stored in `scripts/hooks/pre-commit` (version controlled).

**To install:**
```bash
./scripts/install-hooks.sh
```

This copies the hook to `.git/hooks/pre-commit` and makes it executable. The hook runs:
- Lint (prettier + eslint via corepack yarn)
- Typecheck (tsc)
- Server build (tsc)

Full root build (incl. UI) is available via `yarn run build` but is too slow for pre-commit. Corepack ensures correct Yarn 4 usage.

## Testing

- Server tests: `yarn workspace server run vitest run`
- UI tests: `yarn workspace ui run test`

## Deployment

- Merge to `staging` for pre-production
- User handles `staging` → `main` merge and Railway deployment

Last updated: 2026-04-15
