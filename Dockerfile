FROM node:23.6.1 AS base

RUN mkdir -p /app
WORKDIR /app

# Yarn is already included in the node:23.6.1 image

ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI
ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL

COPY yarn.lock yarn.lock
COPY package.json package.json
COPY tsconfig.json tsconfig.json

# Copy and build frontend first
COPY packages packages
RUN yarn --frozen-lockfile

RUN yarn run build

CMD ["yarn", "run", "server"]
