/**
 * @module image-placeholders
 * Recognition of upstream "we have no artwork for this" graphics.
 *
 * Some sources answer a request for a logo they do not hold with HTTP 200 and a
 * generic graphic rather than a 404. Nothing earlier in the fetch path can tell
 * those apart from real artwork: the status is success, the content type is an
 * image, the bytes decode cleanly, and the file clears the minimum size a real
 * logo has to reach. Only the picture itself gives it away, so that is what is
 * matched here.
 *
 * Fingerprints are taken over *sanitized* bytes rather than the bytes as
 * fetched. A content delivery network in front of the source may recompress a
 * lossless image on its way to us, which changes the raw bytes while leaving the
 * decoded picture identical. Running a candidate through the same re-encode that
 * storage already applies normalizes that away, and the re-encode is idempotent,
 * so a single fingerprint matches both a fresh download and a copy that has been
 * sitting in the image table since an earlier run.
 */
import { createHash } from 'node:crypto'

/** One upstream graphic that means "no artwork", identified by its content. */
type KnownPlaceholder = {
  /** What the graphic is and where it comes from, for whoever reads this next. */
  readonly note: string
  /** Hex-encoded sha256 of the sanitized bytes. */
  readonly fingerprint: string
  /**
   * Length of those same sanitized bytes. Serves as a cheap prefilter so the
   * common case — a real logo — is rejected on an integer comparison instead of
   * a hash. It must be kept in step with `fingerprint`: a mismatched length
   * would silently stop the entry from ever matching, which is why
   * `image-placeholders.test.ts` derives both from the committed fixture.
   */
  readonly byteLength: number
}

export const knownPlaceholders: readonly KnownPlaceholder[] = [
  {
    note:
      'DexScreener chain icon for networks it carries no artwork for: a grey circle with a ' +
      'question mark, served as HTTP 200 from dd.dexscreener.com/ds-data/chains/<chain>.png. ' +
      '31 of the 97 chains in the harvested sidebar resolve to this one file. Fixture: ' +
      'src/harvested/dexscreener/chain-placeholder.png',
    fingerprint: 'a27284ae7ebe270ca5583dff1cbfb7489f3609a74c88d183b4a66233ff3ad734',
    byteLength: 903,
  },
  {
    note:
      'An earlier rendering of the same DexScreener question mark, no longer served upstream but ' +
      'still held by rows stored while it was. Same sanitized length as the current one and a ' +
      'different fingerprint, which is the case the length prefilter alone cannot decide. Fixture: ' +
      'src/harvested/dexscreener/chain-placeholder-legacy.png',
    fingerprint: '28ef5d27d789fd31e644ed1f7254f44aa5b728aa178e393bc72b5da2ef631d10',
    byteLength: 903,
  },
]

const fingerprints: ReadonlySet<string> = new Set(knownPlaceholders.map((placeholder) => placeholder.fingerprint))

/**
 * Every distinct sanitized length a known placeholder takes. Exported so a
 * database sweep can narrow candidate rows to those worth hashing.
 */
export const placeholderByteLengths: readonly number[] = [
  ...new Set(knownPlaceholders.map((placeholder) => placeholder.byteLength)),
]

/**
 * Filenames upstream token lists use to say "this coin has no logo".
 *
 * CoinGecko is the source of these: rather than omitting `logoURI`, its exports
 * point at a `missing_*.png` under the usual assets host, so the entry looks
 * like every other one until the name is read. Matching happens on the filename
 * alone because the directory in front of it carries a per-coin identifier and
 * differs on every row.
 */
const placeholderFileNames: ReadonlySet<string> = new Set([
  'missing_large.png',
  'missing_small.png',
  'missing_thumb.png',
])

/**
 * Whether a logo address is one an upstream list uses to mean "no logo".
 *
 * Cheaper than `isPlaceholderImage` and answerable before any download, but it
 * only catches sources that name their placeholder honestly. A source that
 * serves its placeholder under an ordinary-looking name — DexScreener returns
 * one from `chains/iotex.png` — can only be caught by content.
 */
export const isPlaceholderUri = (uri: string | null | undefined): boolean => {
  if (!uri) return false
  const [withoutQuery] = uri.split(/[?#]/)
  const fileName = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1).toLowerCase()
  return placeholderFileNames.has(fileName)
}

/** Hex-encoded sha256 of an image's bytes. */
export const contentFingerprint = (image: Buffer): string => createHash('sha256').update(image).digest('hex')

/**
 * Whether these bytes are a known upstream placeholder rather than real artwork.
 *
 * Expects bytes that have already been through `sanitizeImage`, which is what
 * both the storage path and the image table hold.
 */
export const isPlaceholderImage = (image: Buffer): boolean => {
  if (!image.length) return false
  // A length that matches nothing on the list cannot hash to anything on it.
  if (!placeholderByteLengths.includes(image.length)) return false
  return fingerprints.has(contentFingerprint(image))
}
