import promiseLimit from 'promise-limit'
import * as utils from '@/utils'
import { type Collectable, collectables } from '@/collect/collectables'
import { counterTypes, rowTypes } from '@/log/types'

const PROVIDER_CONCURRENCY = 4
const providerSection = utils.terminal.issue('collect')
const progress = providerSection.issue({
  type: rowTypes.SUMMARY,
  id: 'collect',
})
/**
 * Main collection function that orchestrates data collection from multiple providers
 */
export const main = async (providers: Collectable[]) => {
  const c = collectables()

  const limit = promiseLimit<Collectable>(PROVIDER_CONCURRENCY)
  progress.createCounter(counterTypes.PROVIDER, providers.length)
  await limit.map(providers, async (provider) => {
    const collector = c[provider]
    if (!collector) {
      progress.increment('skipped')
    } else {
      progress.increment('running')
      try {
        await collector()
      } catch (err) {
        console.log(err)
        progress.increment('erred')
        // erred.push({ provider, err })
      }
      progress.decrement('running')
    }
    progress.increment(counterTypes.PROVIDER)
  })
  progress.complete()
}
