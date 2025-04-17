import promiseLimit from 'promise-limit'
import * as utils from '@/utils'
import { type Collectable, collectables } from '@/collect/collectables'
import { terminalCounterTypes, terminalRowTypes } from '@/log/types'
import { failureLog } from 'packages/utils/src'

const PROVIDER_CONCURRENCY = 4
/**
 * Main collection function that orchestrates data collection from multiple providers
 */
export const main = async (providers: Collectable[]) => {
  const controller = new AbortController()
  const c = collectables()

  const limit = promiseLimit<Collectable>(PROVIDER_CONCURRENCY)
  utils.terminalRow.update({
    id: 'collect',
    type: terminalRowTypes.SUMMARY,
  })
  utils.terminalRow.createCounter(terminalCounterTypes.PROVIDER)
  utils.terminalRow.incrementTotal(terminalCounterTypes.PROVIDER, providers.length)
  await limit.map(providers, async (provider) => {
    if (controller.signal.aborted) {
      return
    }
    const collector = c[provider]
    if (!collector) {
      utils.terminalRow.increment('skipped', provider)
    } else {
      utils.terminalRow.increment('running', provider)
      try {
        await collector(controller.signal)
        utils.terminalRow.increment('success', provider)
      } catch (err) {
        utils.terminalRow.increment('erred', provider)
        failureLog('failed to collect', provider, (err as Error).message)
      }
      utils.terminalRow.decrement('running', provider)
    }
    utils.terminalRow.increment(terminalCounterTypes.PROVIDER, provider)
  })
  utils.terminalRow.complete()
}
