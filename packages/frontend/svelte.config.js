// import adapter from '@sveltejs/adapter-static'
// import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

// const config = {
//   kit: {
//     adapter: adapter(),
//     paths: {
//       relative: true,
//     },
//     // appDir: '_app',
//     version: {
//       name: Date.now().toString(),
//     },
//     // prerender: {
//     //   handleHttpError: 'warn',
//     //   entries: ['*'],
//     //   handleMissingId: 'ignore',
//     // },
//     router: {
//       type: 'hash',
//     },
//   },
//   preprocess: vitePreprocess(),
// }

// export default config
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  // Consult https://svelte.dev/docs#compile-time-svelte-preprocess
  // for more information about preprocessors
  preprocess: vitePreprocess(),
}
