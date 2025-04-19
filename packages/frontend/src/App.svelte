<script lang="ts">
  import Layout from './Layout.svelte'
  import { page } from './lib/stores/page.svelte'
  import Home from './lib/pages/page.svelte'
  import Wizard from './lib/pages/wizard/page.svelte'
  import Docs from './lib/pages/docs/page.svelte'
</script>

<Layout>
  {#if page.route.id === '/'}
  <Home />
  {:else if page.route.id === '/wizard'}
  <Wizard />
  {:else if page.route.id === '/docs'}
  <Docs />
  {/if}
</Layout>
