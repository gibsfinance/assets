# Build stage
FROM node:23.6.1-alpine AS builder

WORKDIR /usr/src/app

# Copy dependency files
COPY yarn.lock package.json tsconfig.json ./

# Copy package files for workspaces
COPY packages packages

# Install dependencies and build
RUN yarn --frozen-lockfile --production=false && \
    yarn run build && \
    yarn --frozen-lockfile --production=true && \
    yarn cache clean

# Production stage
FROM node:23.6.1-alpine AS production

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
COPY package.json yarn.lock tsconfig.json ./

CMD ["yarn", "run", "server"]
