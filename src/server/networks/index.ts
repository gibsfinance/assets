import { Router } from 'express'
import { getDB } from '../../db/index'
import { tableNames } from '@/db/tables'
import { Network } from 'knex/types/tables.js'
import { cacheResult } from '@/utils'
import { nextOnError } from '../utils'
export const router = Router() as Router

const getNetworks = cacheResult<Network[]>(async () => {
  return await getDB().select<Network[]>(['*']).from(tableNames.network)
})

router.get(
  '/',
  nextOnError(async (_req, res) => {
    const networks = await getNetworks()
    res.json(networks)
  }),
)
