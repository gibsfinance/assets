import { Router, json } from 'express'
import * as db from '../db'
import { nextOnError } from './utils'

export const router = Router() as Router

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)

interface SubmissionRow {
  id: string
  url: string
  name: string
  description: string
  submitted_by: string
  status: string
  provider_key: string
  list_key: string
  image_mode: string
  fail_count: number
  subscriber_count: number
  last_content_hash: string | null
  last_fetched_at: Date | null
  last_accessed_at: Date | null
  created_at: Date
  updated_at: Date
}

/**
 * POST /api/lists/submit
 * Submit a token list URL for inclusion in the collection pipeline.
 */
router.post('/submit', json(), nextOnError(async (req, res) => {
  const { url, name, submittedBy, description } = req.body as Record<string, string>

  if (!url || !name || !submittedBy) {
    res.status(400).json({ error: 'url, name, and submittedBy are required' })
    return
  }

  // Validate URL format
  try {
    new URL(url)
  } catch {
    res.status(400).json({ error: 'Invalid URL' })
    return
  }

  // Validate the URL actually serves a token list
  try {
    const probe = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!probe.ok) {
      res.status(400).json({ error: `URL returned ${probe.status}` })
      return
    }
    const data = await probe.json()
    if (!Array.isArray(data?.tokens)) {
      res.status(400).json({ error: 'URL does not serve a valid token list (missing tokens array)' })
      return
    }
  } catch (err) {
    res.status(400).json({ error: `Failed to fetch URL: ${(err as Error).message}` })
    return
  }

  const providerKey = `user-${slugify(submittedBy)}`
  const listKey = slugify(name)

  try {
    const [row] = await db.getDB()
      .insert({
        url,
        name,
        description: description || '',
        submitted_by: submittedBy,
        status: 'pending',
        provider_key: providerKey,
        list_key: listKey,
        image_mode: 'auto',
        fail_count: 0,
        subscriber_count: 0,
      })
      .into('list_submission')
      .onConflict('url')
      .merge(['name', 'description', 'submitted_by', 'updated_at'])
      .returning<SubmissionRow[]>('*')

    res.status(201).json({
      id: row.id,
      status: row.status,
      providerKey: row.provider_key,
      listKey: row.list_key,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
}))

/**
 * GET /api/lists/submissions
 * List all submissions. Optional ?status=pending filter.
 */
router.get('/submissions', nextOnError(async (req, res) => {
  let q = db.getDB().select('*').from('list_submission').orderBy('created_at', 'desc')

  const query = req.query as Record<string, string>
  if (query.status) {
    q = q.where('status', query.status)
  }

  const rows = await q as SubmissionRow[]
  res.json(rows.map((r) => ({
    id: r.id,
    url: r.url,
    name: r.name,
    description: r.description,
    submittedBy: r.submitted_by,
    status: r.status,
    providerKey: r.provider_key,
    listKey: r.list_key,
    imageMode: r.image_mode,
    failCount: r.fail_count,
    subscriberCount: r.subscriber_count,
    lastFetchedAt: r.last_fetched_at,
    createdAt: r.created_at,
  })))
}))

/**
 * PATCH /api/lists/submissions/:id
 * Update a submission's status or image mode. Admin-only in practice.
 */
router.patch('/submissions/:id', json(), nextOnError(async (req, res) => {
  const { id } = req.params as Record<string, string>
  const { status, imageMode } = req.body as Record<string, string>

  const updates: Record<string, unknown> = {}
  if (status && ['pending', 'approved', 'rejected', 'stale'].includes(status)) {
    updates.status = status
  }
  if (imageMode && ['link', 'save', 'auto'].includes(imageMode)) {
    updates.image_mode = imageMode
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }

  const [row] = await db.getDB()
    .update(updates)
    .from('list_submission')
    .where('id', id)
    .returning<SubmissionRow[]>('*')

  if (!row) {
    res.status(404).json({ error: 'Submission not found' })
    return
  }

  res.json({ id: row.id, status: row.status, imageMode: row.image_mode })
}))

export interface SubmissionForAutoMode {
  image_mode: string
  subscriber_count: number
  last_accessed_at?: string | null
}

/**
 * Resolve the effective image mode for a submission.
 * Returns the new mode string if a transition should occur, or null if no change is needed.
 */
export function resolveImageMode(row: SubmissionForAutoMode): string | null {
  const AUTO_SAVE_THRESHOLD = 100
  const AUTO_LINK_THRESHOLD = 10
  const STALE_DAYS = 30

  if (row.image_mode === 'auto') {
    return row.subscriber_count >= AUTO_SAVE_THRESHOLD ? 'save' : 'link'
  }

  if (row.image_mode === 'save' && row.subscriber_count < AUTO_LINK_THRESHOLD) {
    const daysSinceAccess = row.last_accessed_at
      ? (Date.now() - new Date(row.last_accessed_at).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity
    if (daysSinceAccess > STALE_DAYS) {
      return 'link'
    }
  }

  return null
}

/**
 * GET /api/lists/submissions/approved
 * Returns approved submissions for the collector to process.
 * Internal endpoint used by the collection pipeline.
 */
router.get('/submissions/approved', nextOnError(async (_req, res) => {
  const rows = await db.getDB()
    .select('*')
    .from('list_submission')
    .where('status', 'approved')
    .orderBy('subscriber_count', 'desc') as SubmissionRow[]

  for (const row of rows) {
    const newMode = resolveImageMode(row)
    if (newMode && newMode !== row.image_mode) {
      await db.getDB().update({ image_mode: newMode }).from('list_submission').where('id', row.id)
      row.image_mode = newMode
    }
  }

  res.json(rows.map((r) => ({
    url: r.url,
    providerKey: r.provider_key,
    listKey: r.list_key,
    imageMode: r.image_mode === 'save' ? 'save' : 'link',
    lastContentHash: r.last_content_hash,
  })))
}))
