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
      trailingSlash: 'always',
      transformPage: ({ html }) => {
        return html
          .replace(/href="\//g, 'href=".')
          .replace(/src="\//g, 'src=".')
          .replace(/from "\//g, 'from ".')
          .replace(/import\("\/\_app/g, 'import("./\_app')
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
  },
  preprocess: vitePreprocess(),
}

export default config
