# Build stage
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

ENV COREPACK_ENABLE_AUTO_PIN=0
COPY package.json ./
RUN corepack enable && corepack install

# Copy only dependency manifests first (maximizes layer cache for install)
COPY yarn.lock .yarnrc.yml ./
COPY packages/utils/package.json packages/utils/package.json
COPY packages/dexscreener/package.json packages/dexscreener/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/react/package.json packages/react/package.json

# Install dependencies (cached unless package.json or lockfile changes)
RUN yarn install --immutable

# Now copy source and build
COPY tsconfig.json ./
COPY packages packages

ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL
RUN yarn run build

# Prune dev dependencies
RUN yarn workspaces focus --all --production && \
    yarn cache clean --all

# Production stage
FROM node:24-alpine AS production

WORKDIR /usr/src/app

ENV COREPACK_ENABLE_AUTO_PIN=0
COPY package.json ./
RUN corepack enable && corepack install

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI
ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL

# Copy only production dependencies and built files
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages ./packages
COPY yarn.lock .yarnrc.yml tsconfig.json ./

CMD ["yarn", "run", "server"]
