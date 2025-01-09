FROM node:20.11.1 AS base

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV
ARG ROOT_URI
ENV ROOT_URI=$ROOT_URI

FROM base AS build
COPY pnpm-lock.yaml /usr/src/app/pnpm-lock.yaml
COPY package.json /usr/src/app/package.json
RUN npm i -g pnpm
RUN pnpm i

COPY src /usr/src/app/src
COPY config.ts /usr/src/app/config.ts
COPY knexfile.ts /usr/src/app/knexfile.ts
COPY tsconfig.json /usr/src/app/tsconfig.json
COPY .eslintrc.mjs /usr/src/app/.eslintrc.mjs
COPY .prettierrc /usr/src/app/.prettierrc

COPY ./config.ts /usr/src/app/config.ts

CMD ["pnpm", "run", "serve"]
