<script lang="ts">
  export let currentPage: number
  export let totalItems: number
  export let tokensPerPage: number

  // Calculate total pages
  $: totalPages = Math.ceil(totalItems / tokensPerPage)

  function goToPreviousPage() {
    if (currentPage > 1) {
      currentPage--
    }
  }

  function goToNextPage() {
    if (currentPage < totalPages) {
      currentPage++
    }
  }
</script>

<div class="flex items-center gap-2">
  <button 
    class="btn btn-sm variant-soft" 
    disabled={currentPage === 1} 
    on:click={goToPreviousPage}
  >
    <i class="fas fa-chevron-left"></i>
  </button>

  <span class="text-sm text-surface-600 dark:text-surface-300">
    Page {currentPage} of {totalPages}
  </span>

  <button 
    class="btn btn-sm variant-soft"
    disabled={currentPage >= totalPages}
    on:click={goToNextPage}
  >
    <i class="fas fa-chevron-right"></i>
  </button>
</div> 