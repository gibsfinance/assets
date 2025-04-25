import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import replace from '@rollup/plugin-replace'
import pkg from './package.json' with { type: 'json' }
import child_process from 'child_process'
import tailwindcss from '@tailwindcss/vite'

let githash = process.env.RAILWAY_GIT_COMMIT_SHA
if (!githash) {
  try {
    githash = child_process.execSync('git rev-parse HEAD').toString().trim()
  } catch {
    // console.error(err)
  }
}
export default defineConfig({
  plugins: [
    tailwindcss(),
    replace({
      preventAssignment: true,
      values: {
        'process.env.PUBLIC_BASE_URL': JSON.stringify(process.env.PUBLIC_BASE_URL),
        'process.env.PUBLIC_NODE_ENV': JSON.stringify(process.env.PUBLIC_NODE_ENV),
        'process.env.PUBLIC_VERSION': JSON.stringify([pkg.version, githash, new Date().toISOString()].join('_')),
      },
    }),
    svelte(),
  ],
  base: './',
  preview: {
    allowedHosts: ['gib.show', 'assets-staging.up.railway.app', 'healthcheck.railway.app'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
    target: 'esnext',
  },
  resolve: {
    alias: {
      $public: './public',
      $images: './src/images',
      $lib: './src/lib',
    },
  },
})
