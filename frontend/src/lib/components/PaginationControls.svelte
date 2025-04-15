<script lang="ts">
  type Props = {
    currentPage: number
    totalItems: number
    tokensPerPage: number
    onpagechange: (desiredPage: number) => void
  }

  const { currentPage, totalItems, tokensPerPage, onpagechange }: Props = $props()

  // Calculate total pages
  const totalPages = $derived(Math.ceil(totalItems / tokensPerPage))
  const canGoLower = $derived(currentPage > 1)
  const canGoHigher = $derived(currentPage < totalPages)

  function goToPreviousPage() {
    if (!canGoLower) return
    onpagechange(currentPage - 1)
  }

  function goToNextPage() {
    if (!canGoHigher) return
    onpagechange(currentPage + 1)
  }
</script>

<div class="flex items-center gap-2">
  <button
    class="variant-ghost-surface btn"
    aria-label="Previous page"
    onclick={() => goToPreviousPage()}
    disabled={currentPage === 1}>
    <i class="fas fa-chevron-left"></i>
  </button>

  <span class="text-sm text-surface-600 dark:text-surface-300">
    Page {currentPage} of {totalPages}
  </span>

  <button
    class="variant-ghost-surface btn"
    aria-label="Next page"
    onclick={() => goToNextPage()}
    disabled={currentPage === totalPages}>
    <i class="fas fa-chevron-right"></i>
  </button>
</div>
