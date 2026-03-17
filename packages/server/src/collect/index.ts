import promiseLimit from 'promise-limit'
import * as utils from '../utils'
import { type Collectable, collectables } from '../collect/collectables'
import { terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '../log/types'
import { failureLog } from '@gibs/utils'
import { forceRerender } from '../log/App'

const PROVIDER_CONCURRENCY = 4
/**
 * Main collection function that orchestrates data collection from multiple providers
 */
export const main = async (providers: Collectable[], logger: string = 'terminal') => {
  const c = collectables()

  if (logger === 'raw') {
    // Raw logger - no terminal operations, just console logging
    console.log(`Starting collection for providers: ${providers.join(', ')}`)
    // Run providers sequentially for isolation testing
    for (const provider of providers) {
      console.log(`\n=== Processing provider: ${provider} ===`)
      if (utils.controller.signal.aborted) {
        console.log(`Aborted, skipping ${provider}`)
        continue
      }
      const collector = c[provider]
      if (!collector) {
        console.log(`No collector found for ${provider}, skipping`)
      } else {
        console.log(`Starting collector for ${provider}`)
        const startTime = Date.now()
        try {
          await collector(utils.controller.signal)
          const duration = ((Date.now() - startTime) / 1000).toFixed(1)
          console.log(`✅ Collector ${provider} completed successfully in ${duration}s`)
        } catch (err) {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1)
          console.error(`❌ Collector ${provider} failed after ${duration}s:`, err)
          failureLog('error %o %o', provider, err)
          failureLog('failed to collect', provider, (err as Error).message)
        }
      }
    }
    console.log('\n🎉 All providers completed!')
  } else {
    // Normal terminal/pretty logging
    const limit = promiseLimit<Collectable>(PROVIDER_CONCURRENCY)
    utils.terminalRow.update({
      id: 'collect',
      type: terminalRowTypes.SUMMARY,
    })
    utils.terminalRow.createCounter(terminalCounterTypes.PROVIDER)
    utils.terminalRow.incrementTotal(terminalCounterTypes.PROVIDER, new Set(providers))
    await limit.map(providers, async (provider) => {
      if (utils.controller.signal.aborted) {
        return
      }
      const collector = c[provider]
      if (!collector) {
        utils.terminalRow.increment('skipped', provider)
      } else {
        utils.terminalRow.increment('running', provider)
        try {
          await collector(utils.controller.signal)
          utils.terminalRow.increment('success', provider)
        } catch (err) {
          failureLog('error %o %o', provider, err)
          utils.terminalRow.increment(terminalLogTypes.EROR, provider)
          failureLog('failed to collect', provider, (err as Error).message)
        }
        utils.terminalRow.decrement('running', provider)
      }
      utils.terminalRow.increment(terminalCounterTypes.PROVIDER, provider)
    })
    utils.terminalRow.complete()
    forceRerender()
  }
}
