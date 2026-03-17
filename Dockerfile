# Build stage
FROM node:24-alpine AS builder

RUN corepack enable

WORKDIR /usr/src/app

# Copy dependency files
COPY yarn.lock package.json .yarnrc.yml tsconfig.json ./

# Copy package files for workspaces
COPY packages packages

# Install dependencies and build
RUN yarn install --immutable && \
    yarn run build && \
    yarn workspaces focus --all --production && \
    yarn cache clean --all

# Production stage
FROM node:24-alpine AS production

RUN corepack enable

WORKDIR /usr/src/app

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI
ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL

# Copy only production dependencies and built files
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/packages ./packages
COPY package.json yarn.lock .yarnrc.yml tsconfig.json ./

CMD ["yarn", "run", "server"]
