import { Router, json } from 'express'
import * as fileType from 'file-type'
import * as db from '../db'
import { nextOnError } from './utils'

export const router = Router() as Router

const MAX_IMAGE_SIZE = 512 * 1024 // 512 KB
const PROVIDER_KEY = 'user-submit'

/**
 * Parse a data URI into its MIME type and decoded Buffer.
 * Returns null if the string is not a valid base64 data URI.
 */
export function parseDataUri(dataUri: string): { mime: string; buffer: Buffer } | null {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') }
}

/**
 * POST /api/images/submit
 *
 * Accept a base64-encoded image and store it in the pipeline.
 *
 * Body:
 *   chainId     – numeric chain ID (e.g. 1)
 *   address     – token contract address
 *   image       – data URI: "data:image/png;base64,..."
 *   submittedBy – identifier for the submitter (e.g. "anon")
 *
 * Response 201:
 *   imageHash   – content-addressed hash of the stored image
 *   imageUrl    – relative URL to retrieve the image directly
 */
router.post('/submit', json({ limit: '1mb' }), nextOnError(async (req, res) => {
  const { chainId, address, image, submittedBy } = req.body as Record<string, unknown>

  if (!chainId || !address || !image || !submittedBy) {
    res.status(400).json({ error: 'Missing required fields: chainId, address, image, submittedBy' })
    return
  }

  if (typeof image !== 'string' || !image.startsWith('data:')) {
    res.status(400).json({ error: 'image must be a data URI (data:image/...;base64,...)' })
    return
  }

  const parsed = parseDataUri(image)
  if (!parsed) {
    res.status(400).json({ error: 'Invalid data URI format' })
    return
  }

  if (parsed.buffer.length > MAX_IMAGE_SIZE) {
    res.status(400).json({ error: `Image exceeds ${MAX_IMAGE_SIZE / 1024}KB limit` })
    return
  }

  // Detect actual format from magic bytes — do not trust the declared MIME
  const detected = await fileType.fileTypeFromBuffer(Uint8Array.from(parsed.buffer))

  if (!detected || !detected.mime.startsWith('image/')) {
    // file-type cannot detect SVG (plain-text format); fall back to content sniff
    const head = parsed.buffer.toString('utf8', 0, Math.min(parsed.buffer.length, 512))
    if (!head.includes('<svg')) {
      res.status(400).json({ error: 'Unrecognized image format' })
      return
    }
  }

  const originalUri = `submit://${String(submittedBy)}/${String(chainId)}/${String(address).toLowerCase()}`

  const result = await db.insertImage({
    providerKey: PROVIDER_KEY,
    originalUri,
    image: parsed.buffer,
    listId: null,
  })

  if (!result) {
    res.status(400).json({ error: 'Failed to process image — unrecognized format' })
    return
  }

  res.status(201).json({
    imageHash: result.image.imageHash,
    imageUrl: `/image/direct/${result.image.imageHash}`,
  })
}))
