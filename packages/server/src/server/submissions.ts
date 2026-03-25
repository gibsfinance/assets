import { Router, json } from 'express'
import { nextOnError } from './utils'
import { getDrizzle } from '../db/drizzle'
import { eq, desc, sql as dsql } from 'drizzle-orm'
import * as s from '../db/schema'

export const router = Router() as Router

const slugify = (str: string) =>
  str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)

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
    const db = getDrizzle()
    const [row] = await db
      .insert(s.listSubmission)
      .values({
        url,
        name,
        description: description || '',
        submittedBy,
        status: 'pending',
        providerKey,
        listKey,
        imageMode: 'auto',
        failCount: 0,
        subscriberCount: 0,
      })
      .onConflictDoUpdate({
        target: s.listSubmission.url,
        set: {
          name: dsql`excluded.name`,
          description: dsql`excluded.description`,
          submittedBy: dsql`excluded.submitted_by`,
          updatedAt: dsql`NOW()`,
        },
      })
      .returning()

    res.status(201).json({
      id: row.id,
      status: row.status,
      providerKey: row.providerKey,
      listKey: row.listKey,
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
  const db = getDrizzle()
  const query = req.query as Record<string, string>

  let q = db
    .select()
    .from(s.listSubmission)
    .orderBy(desc(s.listSubmission.createdAt))
    .$dynamic()

  if (query.status) {
    q = q.where(eq(s.listSubmission.status, query.status))
  }

  const rows = await q
  res.json(rows.map((r) => ({
    id: r.id,
    url: r.url,
    name: r.name,
    description: r.description,
    submittedBy: r.submittedBy,
    status: r.status,
    providerKey: r.providerKey,
    listKey: r.listKey,
    imageMode: r.imageMode,
    failCount: r.failCount,
    subscriberCount: r.subscriberCount,
    lastFetchedAt: r.lastFetchedAt,
    createdAt: r.createdAt,
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
    updates.imageMode = imageMode
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }

  const db = getDrizzle()
  const [row] = await db
    .update(s.listSubmission)
    .set(updates)
    .where(eq(s.listSubmission.id, id))
    .returning()

  if (!row) {
    res.status(404).json({ error: 'Submission not found' })
    return
  }

  res.json({ id: row.id, status: row.status, imageMode: row.imageMode })
}))

export interface SubmissionForAutoMode {
  image_mode: string
  subscriber_count: number
  last_accessed_at?: string | Date | null
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
  const db = getDrizzle()
  const rows = await db
    .select()
    .from(s.listSubmission)
    .where(eq(s.listSubmission.status, 'approved'))
    .orderBy(desc(s.listSubmission.subscriberCount))

  for (const row of rows) {
    const newMode = resolveImageMode({
      image_mode: row.imageMode,
      subscriber_count: row.subscriberCount,
      last_accessed_at: row.lastAccessedAt,
    })
    if (newMode && newMode !== row.imageMode) {
      await db
        .update(s.listSubmission)
        .set({ imageMode: newMode })
        .where(eq(s.listSubmission.id, row.id))
      row.imageMode = newMode
    }
  }

  res.json(rows.map((r) => ({
    url: r.url,
    providerKey: r.providerKey,
    listKey: r.listKey,
    imageMode: r.imageMode === 'save' ? 'save' : 'link',
    lastContentHash: r.lastContentHash,
  })))
}))
