#!/bin/bash

# this should never be run on a production env
# this is only to be used during schema iteration on a local database

if [ "${NODE_ENV}" != "development" ]; then
  echo "NODE_ENV is not development, instead ${NODE_ENV}"
  exit 1
fi

if [[ "${DATABASE_URL}" != *":password@"* ]]; then
  echo "DATABASE_URL is not resetting an unsecured database"
  exit 1
fi

tsx ./node_modules/.bin/knex migrate:rollback --all

tsx ./node_modules/.bin/knex migrate:latest

tsx ./node_modules/.bin/knex seed:run
