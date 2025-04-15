import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    paths: {
      relative: true,
    },
    // appDir: '_app',
    version: {
      name: Date.now().toString(),
    },
    // prerender: {
    //   handleHttpError: 'warn',
    //   entries: ['*'],
    //   handleMissingId: 'ignore',
    // },
    router: {
      type: 'hash',
    },
  },
  preprocess: vitePreprocess(),
}

export default config
