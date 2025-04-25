FROM node:23.6.1 AS base

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI

FROM base AS build
COPY package-lock.json package-lock.json
COPY package.json package.json

# Copy and build frontend first
COPY packages packages
RUN npm i

CMD ["npm", "run", "server"]
