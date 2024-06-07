# this should never be run on a production env
# this is only to be used during schema iteration on a local database

tsx ./node_modules/.bin/knex migrate:rollback --all

tsx ./node_modules/.bin/knex migrate:latest

tsx ./node_modules/.bin/knex seed:run
