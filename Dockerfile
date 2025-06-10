FROM node:23.6.1 AS base

RUN mkdir -p /app
WORKDIR /app

ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI
ARG PUBLIC_BASE_URL
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL

COPY package-lock.json package-lock.json
COPY package.json package.json
COPY tsconfig.json tsconfig.json

# Copy and build frontend first
COPY packages packages
RUN npm i

RUN npm run build

CMD ["npm", "run", "server"]
