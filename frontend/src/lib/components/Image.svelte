<script lang="ts">
  import type { Snippet } from 'svelte'

  type FallbackProps = {
    height?: number
    width?: number
    class?: string
    style?: string
    src?: string
    alt?: string
  }
  type Props = {
    size?: number
    height?: number
    width?: number
    class?: string
    style?: string
    src: string
    alt?: string
    onerror?: () => void
    fallback?: Snippet<[FallbackProps]>
    fallbackProps?: FallbackProps
  }

  const {
    size = 48,
    height,
    width,
    class: className,
    src,
    alt,
    style,
    fallbackProps,
    fallback,
    onerror,
  }: Props = $props()
  const h = $derived(height || size)
  const w = $derived(width || size)

  let shouldFallback = $state(false)
  const handleFallback = () => {
    shouldFallback = true
    onerror?.()
  }
</script>

{#if shouldFallback}
  {#if fallback}
    {@render fallback({ height: h, width: w, class: className, src, alt, ...(fallbackProps || {}) })}
  {:else}
    <img {src} {alt} {width} {height} {style} class={className} />
  {/if}
{:else}
  <img {src} {alt} onerror={handleFallback} width={w} height={h} {style} class={className} />
{/if}
