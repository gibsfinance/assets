import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      strict: false,
      precompress: false,
      transformPage: ({ html }) => {
        return html
          .replace(/href="\/_app\//g, 'href="./_app/')
          .replace(/src="\/_app\//g, 'src="./_app/')
          .replace(/from "\/_app\//g, 'from "./_app/')
          .replace(/import\("\/_app/g, 'import("./_app')
          .replace(/import\("\/(_app\/[^"]+)"\)/g, 'import("./$1")')
          .replace(/modulepreload" href="\/_app\//g, 'modulepreload" href="./_app/')
          .replace(/url\(\//g, 'url(.')
          .replace(/"\/favicon/g, '"./favicon')
          .replace(/"\/assets/g, '"./assets')
      },
    }),
    paths: {
      base: '',
      assets: '',
      relative: true,
    },
    appDir: '_app',
    version: {
      name: Date.now().toString(),
    },
    prerender: {
      handleHttpError: 'warn',
      entries: ['*'],
      handleMissingId: 'ignore',
    },
    router: {
      type: 'hash',
    },
  },
  preprocess: vitePreprocess(),
}

export default config
