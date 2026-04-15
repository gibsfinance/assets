/**
 * Pure comparator for sorting token rows by provider ranking.
 * Zero dependencies — safe to import directly in tests.
 */

interface RankableRow {
  listRanking?: number | null
  imageHash?: string | null
  ext?: string | null
  listTokenOrderId?: number | null
}

/** Sort token rows by provider ranking → image presence → format preference → list order */
export function rankTokenRows(a: RankableRow, b: RankableRow): number {
  const rankA = Math.floor((a.listRanking ?? Number.MAX_SAFE_INTEGER) / 1000)
  const rankB = Math.floor((b.listRanking ?? Number.MAX_SAFE_INTEGER) / 1000)
  if (rankA !== rankB) return rankA - rankB
  const imgA = a.imageHash ? 0 : 1
  const imgB = b.imageHash ? 0 : 1
  if (imgA !== imgB) return imgA - imgB
  const fmtA = a.ext === '.svg' || a.ext === '.svg+xml' ? 0 : a.ext === '.webp' ? 1 : 2
  const fmtB = b.ext === '.svg' || b.ext === '.svg+xml' ? 0 : b.ext === '.webp' ? 1 : 2
  if (fmtA !== fmtB) return fmtA - fmtB
  return (a.listTokenOrderId ?? 0) - (b.listTokenOrderId ?? 0)
}
