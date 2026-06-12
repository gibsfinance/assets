/**
 * @module submissions
 * User-submitted token list CRUD: submit, review, approve, and auto-mode resolution.
 *
 * `POST /submit` — validates URL (scheme + private-address guard, then probes
 * for JSON with `tokens` array), generates providerKey/listKey via slugify,
 * inserts into `list_submission` with upsert.
 * `PATCH /submissions/:id` — admin-only (bearer ADMIN_TOKEN) moderation.
 * `GET /submissions/approved` — admin-only feed of approved lists for the
 * collector pipeline, auto-upgrading image mode based on subscriber count and
 * access recency (writes transitions back to the database).
 */
import { Router, json } from 'express'
import { nextOnError } from './utils'
import { requireAdminToken } from './admin-auth'
import { validateOutboundUrl } from './url-guard'
import { getDrizzle } from '../db/drizzle'
import { eq, desc, sql as dsql } from 'drizzle-orm'
import * as s from '../db/schema'
import type { ListSubmission } from '../db/schema-types'

export const router = Router() as Router

const slugify = (str: string) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)

/** Allowed submission statuses (mirrored in the OpenAPI Submission schema). */
const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected', 'stale']

/** Allowed image modes (mirrored in the OpenAPI Submission schema). */
const IMAGE_MODES = ['link', 'save', 'auto']

/** Map a list_submission row to the public Submission response shape. */
const toSubmission = (r: ListSubmission) => ({
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
})

/**
 * POST /api/lists/submit
 * Submit a token list URL for inclusion in the collection pipeline.
 * Resubmitting an existing URL updates name/description/submittedBy and
 * returns the row's existing status (it is not reset to pending).
 */
router.post(
  '/submit',
  json(),
  nextOnError(async (req, res) => {
    const { url, name, submittedBy, description } = req.body as Record<string, string>

    if (!url || !name || !submittedBy) {
      res.status(400).json({ error: 'url, name, and submittedBy are required' })
      return
    }

    // Scheme allowlist + private-address guard (server-side request forgery)
    const validation = await validateOutboundUrl(url)
    if (!validation.ok) {
      res.status(400).json({ error: validation.reason })
      return
    }

    // Probe the URL for token-list JSON. Upstream status codes and error
    // details are intentionally not echoed back to the client.
    let probed: { tokens?: unknown } | undefined
    try {
      const probe = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (probe.ok) {
        probed = (await probe.json()) as { tokens?: unknown }
      }
    } catch {
      // network failure or non-JSON body — handled by the guard below
    }
    if (!Array.isArray(probed?.tokens)) {
      res.status(400).json({ error: 'URL did not return a valid token list' })
      return
    }

    const providerKey = `user-${slugify(submittedBy)}`
    const listKey = slugify(name)

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
  }),
)

/**
 * GET /api/lists/submissions
 * List all submissions. Optional ?status=pending filter.
 */
router.get(
  '/submissions',
  nextOnError(async (req, res) => {
    const db = getDrizzle()
    const query = req.query as Record<string, string>

    let q = db.select().from(s.listSubmission).orderBy(desc(s.listSubmission.createdAt)).$dynamic()

    if (query.status) {
      q = q.where(eq(s.listSubmission.status, query.status))
    }

    const rows = await q
    res.json(rows.map(toSubmission))
  }),
)

/**
 * PATCH /api/lists/submissions/:id
 * Update a submission's status or image mode.
 * Admin-only: requires the ADMIN_TOKEN bearer token.
 */
router.patch(
  '/submissions/:id',
  requireAdminToken,
  json(),
  nextOnError(async (req, res) => {
    const { id } = req.params as Record<string, string>
    const { status, imageMode } = req.body as Record<string, string | undefined>

    if (status !== undefined && !SUBMISSION_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status — allowed values: ${SUBMISSION_STATUSES.join(', ')}` })
      return
    }
    if (imageMode !== undefined && !IMAGE_MODES.includes(imageMode)) {
      res.status(400).json({ error: `Invalid imageMode — allowed values: ${IMAGE_MODES.join(', ')}` })
      return
    }

    const updates: Record<string, unknown> = {}
    if (status) updates.status = status
    if (imageMode) updates.imageMode = imageMode

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'Nothing to update' })
      return
    }

    const db = getDrizzle()
    const [row] = await db.update(s.listSubmission).set(updates).where(eq(s.listSubmission.id, id)).returning()

    if (!row) {
      res.status(404).json({ error: 'Submission not found' })
      return
    }

    res.json(toSubmission(row))
  }),
)

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
 * Returns approved submissions for the collector to process, persisting
 * auto-mode image transitions back to the database as a side effect.
 * Admin-only: requires the ADMIN_TOKEN bearer token (the in-process
 * collector reads the database directly via collect/user-submissions.ts).
 */
router.get(
  '/submissions/approved',
  requireAdminToken,
  nextOnError(async (_req, res) => {
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
        await db.update(s.listSubmission).set({ imageMode: newMode }).where(eq(s.listSubmission.id, row.id))
        row.imageMode = newMode
      }
    }

    res.json(
      rows.map((r) => ({
        url: r.url,
        providerKey: r.providerKey,
        listKey: r.listKey,
        imageMode: r.imageMode === 'save' ? 'save' : 'link',
        lastContentHash: r.lastContentHash,
      })),
    )
  }),
)
