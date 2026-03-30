import fs from 'fs'
import path from 'path'
import { harvested } from '../paths'
import * as db from '../db'
import { limitBy } from 'packages/utils/src'
import * as utils from '../utils'
import { terminalLogTypes, terminalRowTypes } from '../log/types'
import { keccak256, stringToHex } from 'viem'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'countries'

class CountriesCollector extends BaseCollector {
  readonly key = 'countries'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    const network = await db.insertNetworkFromChainId(0)
    const [provider] = await db.insertProvider({
      name: 'Countries',
      key: providerKey,
    })
    await db.insertList({
      providerId: provider.providerId,
      name: 'Countries',
      key: providerKey,
      networkId: network.networkId,
      default: true,
    })

    return [
      {
        providerKey,
        lists: [{ listKey: providerKey }],
      },
    ]
  }

  async collect(signal?: AbortSignal): Promise<void> {
    const row = utils.terminal.issue({
      type: terminalRowTypes.SETUP,
      id: providerKey,
    })
    try {
      const filePath = path.join(harvested, 'countries', 'ibrahimhajjaj.json')
      type Country = {
        code: string
        name: string
        countryCode: string
        country: string
        flag: string
      }
      const section = row.issue(providerKey)
      const file = await fs.promises.readFile(filePath, 'utf-8')
      const countries = JSON.parse(file) as Country[]
      const prefix = 'data:image/png;base64,'
      const network = await db.insertNetworkFromChainId(0)
      const [provider] = await db.insertProvider({
        name: 'Countries',
        key: providerKey,
      })
      const [list] = await db.insertList({
        providerId: provider.providerId,
        name: 'Countries',
        key: providerKey,
        networkId: network.networkId,
        default: true,
      })
      const limit = limitBy<[Country, number]>(providerKey, 20)
      row.createCounter(providerKey, true)
      row.createCounter('tasks')
      row.createCounter('skipped', true)
      row.incrementTotal(providerKey, new Set(countries.map((country) => country.code)))
      await limit.map(
        countries.map((country, i) => [country, i]),
        async ([country, i]) => {
          row.increment(providerKey, new Set([country.code]))
          if (!country.flag) {
            row.incrementTotal('skipped', new Set([country.code]))
            return
          }
          const providedId = keccak256(stringToHex(country.code))
          const bytes = Buffer.from(country.flag.replace(prefix, ''), 'base64')
          const task = section.task(`saving-${country.code}`, {
            type: terminalRowTypes.STORAGE,
            id: providerKey,
            message: 'save',
            kv: {
              code: country.code,
            },
          })
          await db.insertToken({
            name: country.name,
            symbol: country.code,
            decimals: 2,
            networkId: network.networkId,
            providedId,
          })
          await db
            .fetchImageAndStoreForToken({
              listId: list.listId,
              uri: bytes,
              originalUri: country.flag,
              providerKey,
              signal,
              listTokenOrderId: i,
              token: {
                name: country.country,
                symbol: country.code,
                decimals: 2,
                networkId: network.networkId,
                providedId,
              },
            })
            .catch((err) => {
              row.increment(terminalLogTypes.EROR, err.message)
              row.increment('skipped', new Set([country.code]))
              return null
            })
          task.complete()
          section.removeRow(`saving-${country.code}`)
        },
      )
      row.remove(providerKey)
    } finally {
      row.complete()
    }
  }
}

const instance = new CountriesCollector()
export default instance
export const collect = (signal?: AbortSignal) => instance.collect(signal as AbortSignal)
