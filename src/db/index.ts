import knex, { type Knex } from 'knex'
import { config } from './config'

let db = knex(config)

export const getDB = () => db

export const setDB = (k: Knex) => {
  db = k
}

type Transact<T> = typeof db.transaction<T>

export const transaction = async <T>(...a: Parameters<Transact<T>>) => (
  db.transaction(...a)
)
