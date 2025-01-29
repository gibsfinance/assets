import { Router } from 'express'
import { getDB } from '../../db/index'
import _ from 'lodash'
import { tableNames } from '@/db/tables'
import { Network } from 'knex/types/tables.js'

export const router = Router()

let cached: null | {
  timestamp: number
  result: Promise<string[]>
} = null
const hour1 = 1000 * 60 * 60
const getNetworks = _.wrap(
  async () => {
    const networks = await getDB().select<Network[]>(['chainId']).from(tableNames.network)
    return networks.map((n) => `${n.chainId}`)
  },
  async (fn) => {
    if (cached) {
      const { timestamp, result } = cached
      if (timestamp > Date.now() - hour1) {
        return result
      }
    }
    const networks = fn()
    cached = {
      timestamp: Date.now(),
      result: networks,
    }
    return networks
  },
)

router.get('/', async (_req, res) => {
  const networks = await getNetworks()
  res.json(networks)
})
