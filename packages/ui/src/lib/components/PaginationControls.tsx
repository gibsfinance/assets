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

  const canGoLower = useMemo(() => currentPage > 1, [currentPage])
  const canGoHigher = useMemo(() => currentPage < totalPages, [currentPage, totalPages])

  function goToPreviousPage() {
    if (!canGoLower) return
    onPageChange(currentPage - 1)
  }

  function goToNextPage() {
    if (!canGoHigher) return
    onPageChange(currentPage + 1)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="variant-ghost-surface btn"
        aria-label="Previous page"
        onClick={() => goToPreviousPage()}
        disabled={currentPage === 1}
      >
        <i className="fas fa-chevron-left"></i>
      </button>

      <span className="text-sm text-surface-600 dark:text-surface-300">
        Page {currentPage} of {totalPages}
      </span>

      <button
        className="variant-ghost-surface btn"
        aria-label="Next page"
        onClick={() => goToNextPage()}
        disabled={currentPage === totalPages}
      >
        <i className="fas fa-chevron-right"></i>
      </button>
    </div>
  )
}
