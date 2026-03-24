import * as viem from 'viem'
import * as db from '../db'
import { RemoteTokenListCollector } from './remote-tokenlist'
import type { BaseCollector } from './base-collector'
import { failureLog } from '@gibs/utils'

interface ApprovedSubmission {
  id: string
  url: string
  provider_key: string
  list_key: string
  image_mode: string
  last_content_hash: string | null
  fail_count: number
}

/**
 * Loads all approved list submissions from the DB and creates
 * RemoteTokenListCollector instances for each.
 *
 * Called during collection startup to dynamically register
 * user-submitted lists alongside hardcoded collectors.
 *
 * Returns a map of providerKey → collector, ready to merge
 * into the collectables map.
 */
export async function loadSubmissionCollectors(): Promise<Record<string, BaseCollector>> {
  const submissions = await db.getDB()
    .select('*')
    .from('list_submission')
    .where('status', 'approved') as ApprovedSubmission[]

  const collectors: Record<string, BaseCollector> = {}

  for (const sub of submissions) {
    const shouldSave = sub.image_mode === 'save'

    collectors[sub.provider_key] = new RemoteTokenListCollector(sub.provider_key, {
      providerKey: sub.provider_key,
      listKey: sub.list_key,
      tokenList: sub.url,
    })
  }

  if (submissions.length > 0) {
    console.log(`Loaded ${submissions.length} user-submitted list collector(s)`)
  }

  return collectors
}

/**
 * After a submission's list is collected, update its metadata:
 * - Reset fail count on success
 * - Increment fail count on failure
 * - Update content hash and last fetched timestamp
 * - Mark stale after 5 consecutive failures
 */
export async function updateSubmissionStatus(
  providerKey: string,
  options: { success: boolean; contentHash?: string },
): Promise<void> {
  const sub = await db.getDB()
    .select('*')
    .from('list_submission')
    .where('provider_key', providerKey)
    .where('status', 'approved')
    .first() as ApprovedSubmission | undefined

  if (!sub) return

  if (options.success) {
    await db.getDB()
      .update({
        fail_count: 0,
        last_fetched_at: new Date(),
        ...(options.contentHash ? { last_content_hash: options.contentHash } : {}),
      })
      .from('list_submission')
      .where('id', sub.id)
  } else {
    const newFailCount = sub.fail_count + 1
    const updates: Record<string, unknown> = {
      fail_count: newFailCount,
      last_fetched_at: new Date(),
    }
    if (newFailCount >= 5) {
      updates.status = 'stale'
      failureLog('Submission %s marked stale after %d failures', providerKey, newFailCount)
    }
    await db.getDB()
      .update(updates)
      .from('list_submission')
      .where('id', sub.id)
  }
}

/**
 * Bump subscriber count when a list is accessed by a client.
 * Called from the list serving endpoints.
 */
export async function bumpSubscriberCount(providerKey: string): Promise<void> {
  await db.getDB()
    .increment('subscriber_count', 1)
    .update({ last_accessed_at: new Date() })
    .from('list_submission')
    .where('provider_key', providerKey)
}
