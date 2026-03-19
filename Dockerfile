# Build stage
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

ENV COREPACK_ENABLE_AUTO_PIN=0
COPY package.json ./
RUN corepack enable && corepack install

# Copy dependency files
COPY yarn.lock .yarnrc.yml tsconfig.json ./

# Copy package files for workspaces
COPY packages packages

# Install dependencies and build
RUN yarn install --immutable && \
    yarn run build && \
    yarn workspaces focus --all --production && \
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
