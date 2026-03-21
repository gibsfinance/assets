import { useMemo } from 'react'

interface PaginationControlsProps {
  currentPage: number
  totalItems: number
  tokensPerPage: number
  onPageChange: (desiredPage: number) => void
}

export default function PaginationControls({
  currentPage,
  totalItems,
  tokensPerPage,
  onPageChange,
}: PaginationControlsProps) {
  const totalPages = useMemo(
    () => Math.ceil(totalItems / tokensPerPage),
    [totalItems, tokensPerPage],
  )

  const canGoLower = currentPage > 1
  const canGoHigher = currentPage < totalPages

  return (
    <div className="flex items-center gap-2">
      <button
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-dark bg-surface-2 text-white/60 transition-colors hover:border-accent-500/30 hover:text-accent-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border-dark disabled:hover:text-white/60"
        aria-label="Previous page"
        onClick={() => canGoLower && onPageChange(currentPage - 1)}
        disabled={!canGoLower}
      >
        <i className="fas fa-chevron-left text-xs" />
      </button>

      <span className="min-w-[5rem] text-center text-sm text-white/50">
        {totalPages > 0 ? `${currentPage} / ${totalPages}` : '0 / 0'}
      </span>

      <button
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-dark bg-surface-2 text-white/60 transition-colors hover:border-accent-500/30 hover:text-accent-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border-dark disabled:hover:text-white/60"
        aria-label="Next page"
        onClick={() => canGoHigher && onPageChange(currentPage + 1)}
        disabled={!canGoHigher}
      >
        <i className="fas fa-chevron-right text-xs" />
      </button>
    </div>
  )
}
