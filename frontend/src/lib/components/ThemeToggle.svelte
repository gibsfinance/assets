<script lang="ts">
  import { isDark } from '$lib/stores/theme'
  import { onMount } from 'svelte'

  const darkModeMessages = [
    'Embrace the darkness...',
    'Join the dark side!',
    'Time to go stealth',
    'Night mode activated',
    'Going incognito...',
    'Welcome to the shadows',
    'Dark mode is the way',
    'Stealth mode engaged',
    'Eyes will thank you',
    'Darkness beckons...',
  ]

  const lightModeMessages = [
    'MY EYES NEED THE LIGHT!',
    'Let there be light!',
    'Time to shine ✨',
    'Brightness intensifies',
    'Hello sunshine!',
    'Illumination activated',
    'Light side prevails',
    'Photons into my ojos',
    'Embrace the glow',
    'Power of the light!',
  ]

  const getRandomMessage = (messages: string[]) => {
    return messages[Math.floor(Math.random() * messages.length)]
  }

  function toggleTheme() {
    isDark.toggle()
  }

  onMount(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    isDark.set(prefersDark)
  })

  $: if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', $isDark)
  }
</script>

<button
  class="variant-ghost-surface btn-icon"
  on:click={toggleTheme}
  title={getRandomMessage($isDark ? lightModeMessages : darkModeMessages)}>
  {#if $isDark}
    <i class="fas fa-sun text-xl"></i>
  {:else}
    <i class="fas fa-moon text-xl"></i>
  {/if}
</button>

<style>
  .btn-icon {
    @apply h-10 w-10 rounded-full;
  }
</style>
