<script lang="ts">
  import Icon from '@iconify/svelte'
  import Image from '$lib/components/Image.svelte'
  import { getApiUrl } from '$lib/utils'

  export let url: string = ''
  export let previewError = false
  export let iconExists = true
  export let isCircularCrop = false
  export let backgroundColor = '#151821'
  export let showColorPicker = false

  let zoomLevel = 1
  let isDragging = false
  let startX = 0
  let startY = 0
  let translateX = 0
  let translateY = 0

  // Add reset function to restore initial state
  export function resetPreview() {
    zoomLevel = 1
    translateX = 0
    translateY = 0
    isCircularCrop = false
    showColorPicker = false
    backgroundColor = '#151821'
    previewError = false
    iconExists = true
  }

  function handleZoomIn() {
    zoomLevel = Math.min(zoomLevel + 0.5, 4)
  }

  function handleZoomOut() {
    zoomLevel = Math.max(zoomLevel - 0.5, 0.5)
  }

  function handleMouseDown(event: MouseEvent) {
    isDragging = true
    startX = event.clientX - translateX
    startY = event.clientY - translateY
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging) return
    translateX = event.clientX - startX
    translateY = event.clientY - startY
  }

  function handleMouseUp() {
    isDragging = false
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    const delta = -Math.sign(event.deltaY)
    const zoomStep = 0.1
    if (delta > 0) {
      zoomLevel = Math.min(zoomLevel + zoomStep, 4)
    } else {
      zoomLevel = Math.max(zoomLevel - zoomStep, 0.5)
    }
  }

  function handleColorInput(event: Event) {
    const input = event.target as HTMLInputElement
    backgroundColor = input.value
  }

  function handleColorTextInput(event: Event) {
    const input = event.target as HTMLInputElement
    const value = input.value.trim()
    // Support various color formats
    if (value.match(/^#[0-9A-Fa-f]{6}$/)) {
      backgroundColor = value
    } else if (value.match(/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/)) {
      backgroundColor = value
    } else if (value.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/)) {
      backgroundColor = value
    }
  }

  // Handle initial image load error
  function handleImageError() {
    previewError = true
    iconExists = false
  }
</script>

<div class="card variant-ghost space-y-2 p-4">
  <div class="flex items-center justify-between">
    <span class="label">Preview</span>
    <div class="flex gap-2">
      <button
        class="variant-soft-surface btn btn-sm"
        on:click={handleZoomOut}
        disabled={zoomLevel <= 0.5}
        aria-label="Zoom out">
        <i class="fas fa-minus"></i>
      </button>
      <span class="flex items-center px-2 text-sm">
        {Math.round(zoomLevel * 100)}%
      </span>
      <button
        class="variant-soft-surface btn btn-sm"
        on:click={handleZoomIn}
        disabled={zoomLevel >= 4}
        aria-label="Zoom in">
        <i class="fas fa-plus"></i>
      </button>
    </div>
  </div>
  <div class="flex flex-col justify-center">
    <button
      type="button"
      class="relative h-[300px] w-full cursor-move overflow-hidden {showColorPicker
        ? ''
        : 'checkerboard'} border border-surface-700/20"
      style="background-color: {showColorPicker ? backgroundColor : ''}"
      on:mousedown={handleMouseDown}
      on:mousemove={handleMouseMove}
      on:mouseup={handleMouseUp}
      on:mouseleave={handleMouseUp}
      on:wheel={handleWheel}
      role="slider"
      aria-label="Token preview zoom control"
      aria-valuemin="50"
      aria-valuemax="400"
      aria-valuenow={Math.round(zoomLevel * 100)}
      aria-valuetext="{Math.round(zoomLevel * 100)}% zoom">
      <Image
        alt="Icon preview"
        src={url}
        class="user-drag-none absolute left-1/2 top-1/2 transition-transform duration-100 {isCircularCrop
          ? 'rounded-full'
          : ''}"
        style="transform: translate(calc(-50% + {translateX}px), calc(-50% + {translateY}px)) scale({zoomLevel})"
        size={128}
        onerror={handleImageError}>
        {#snippet fallback()}
          <Icon icon="nrk:404" class="h-12 w-12" />
        {/snippet}
      </Image>
    </button>
    <div class="mt-2 text-center text-sm text-gray-400">
      <span class="opacity-75">Click and drag to pan • Scroll to zoom</span>
    </div>
  </div>
</div>

<!-- Preview Options -->
<div class="card variant-ghost space-y-4 p-4">
  <span class="label">Preview Options</span>
  <div class="flex flex-col gap-4">
    <!-- Crop Option -->
    <label class="flex items-center gap-2">
      <input type="checkbox" class="checkbox" bind:checked={isCircularCrop} />
      <span>Circular Crop</span>
    </label>

    <!-- Background Options -->
    <div class="space-y-2">
      <label class="flex items-center gap-2">
        <input type="checkbox" class="checkbox" bind:checked={showColorPicker} />
        <span>Custom Background Color</span>
      </label>

      {#if showColorPicker}
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <!-- Color Picker -->
          <div class="space-y-2">
            <label for="color-picker" class="text-sm">Pick a color:</label>
            <input
              id="color-picker"
              type="color"
              class="h-10 w-full cursor-pointer rounded"
              value={backgroundColor}
              on:input={handleColorInput} />
          </div>

          <!-- Color Input -->
          <div class="space-y-2">
            <label for="color-text" class="text-sm">Or enter a color value:</label>
            <input
              id="color-text"
              type="text"
              class="input"
              placeholder="#HEX, rgb(), rgba()"
              value={backgroundColor}
              on:input={handleColorTextInput} />
            <p class="text-xs opacity-75"> Supports HEX (#RRGGBB), RGB (rgb(r,g,b)), and RGBA (rgba(r,g,b,a)) </p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="postcss">
  /* Checkerboard pattern for transparent image background */
  .checkerboard {
    background-color: #fff;
    background-image: linear-gradient(45deg, #ddd 25%, transparent 25%),
      linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%),
      linear-gradient(-45deg, transparent 75%, #ddd 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0px;
  }

  /* Dark mode version - using more subtle colors */
  :global(.dark) .checkerboard {
    background-color: #1a1a1a;
    background-image: linear-gradient(45deg, #252525 25%, transparent 25%),
      linear-gradient(-45deg, #252525 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252525 75%),
      linear-gradient(-45deg, transparent 75%, #252525 75%);
  }

  :global(.user-drag-none) {
    -webkit-user-drag: none;
    user-select: none;
    -moz-user-select: none;
    -webkit-user-select: none;
    -ms-user-select: none;
  }
</style>
