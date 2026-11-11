# Server image: the HTTP server and the built interface it serves.
#
# Four stages, so each one is cached by what it depends on:
#   manifests    every package.json and the lockfile - changes only when dependencies change
#   build-deps   all dependencies, for building the interface
#   prod-deps    only what the server loads at run time
#   interface    the built interface (packages/ui/dist)
# The final stage starts from prod-deps and adds source and the built interface.

FROM node:24-alpine AS manifests

WORKDIR /usr/src/app

ENV COREPACK_ENABLE_AUTO_PIN=0
COPY package.json ./
RUN corepack enable && corepack install

# Only dependency manifests, so the installs below are cached until one changes.
COPY yarn.lock .yarnrc.yml ./
COPY packages/utils/package.json packages/utils/package.json
COPY packages/dexscreener/package.json packages/dexscreener/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/react/package.json packages/react/package.json


# Everything, development tools included. Used only to build the interface.
FROM manifests AS build-deps
RUN yarn install --immutable


# Only the server and the workspaces it imports. The interface's dependencies are
# bundled into packages/ui/dist by the build, so none of them are needed here.
FROM manifests AS prod-deps
RUN yarn workspaces focus server --production && \
    yarn cache clean --all


# The server runs from source (see the final stage), so the only build output it needs is the interface.
# The interface build never reads the other workspaces' output, so the TypeScript
# builds are not repeated here; the typecheck job in CI is what gates them.
FROM build-deps AS interface
COPY tsconfig.json ./
COPY scripts/tsc7.mjs scripts/tsc7.mjs
COPY packages/ui packages/ui

ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL
RUN yarn workspace ui run build


# Production stage
FROM prod-deps AS production

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI
ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL

# Source for the workspaces the server imports. The server and the collector run
# TypeScript directly, so the source is the program.
COPY tsconfig.json ./
COPY packages/utils packages/utils
COPY packages/dexscreener packages/dexscreener
COPY packages/server packages/server
COPY --from=interface /usr/src/app/packages/ui/dist packages/ui/dist

# The server reads docs/skills/*.md and docs/terms.md from disk at request
# time (packages/server/src/server/docs.ts), resolved relative to its own
# source directory rather than the working directory. Nothing else in the
# image needs docs/, so it is copied here rather than into an earlier stage.
COPY docs docs

# Plain node runs the source: Node strips the types, and a small preload (see
# packages/server/src/runtime/node-hooks.ts) finds the files behind extensionless imports and
# compiles the one JSX file. `yarn run server` kept yarn and the tsx launcher alive beside the
# program, about 160 MB for the pair. It changes into packages/server first because the program
# resolves some paths from the working directory, as `yarn run` did; `exec` replaces the shell.
# The container's own working directory stays the repository root.
CMD ["sh", "-c", "cd packages/server && exec node --import ./src/bin/register-hooks.ts ./src/bin/server.ts"]
