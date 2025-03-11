import { Router } from 'express'
import { getDB } from '../../db/index'
import { tableNames } from '@/db/tables'
import { Network } from 'knex/types/tables.js'
import { cacheResult } from '@/utils'

export const router = Router() as Router

const getNetworks = cacheResult<string[]>(async () => {
  const networks = await getDB().select<Network[]>(['chainId']).from(tableNames.network)
  return networks.map((n) => `${n.chainId}`)
})

router.get('/', async (_req, res) => {
  const networks = await getNetworks()
  res.json(networks)
})
