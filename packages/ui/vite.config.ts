import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import replace from '@rollup/plugin-replace'
import pkg from './package.json' with { type: 'json' }
import child_process from 'child_process'
import tailwindcss from '@tailwindcss/vite'
import { pathToFileURL } from 'url'
import path from 'path'
import { injectMarkup } from './src/prerender/inject-markup.ts'
import { themeScript, routeHideScript, routeGuardScript } from './src/prerender/pre-paint.ts'

/**
 * Writes the home page into `index.html` at build time. It imports the bundle that
 * `vite build --ssr` produced just before the client build (see the `build` script),
 * so a client build with no server bundle fails here instead of shipping an empty shell.
 */
const prerenderHome = () => ({
  name: 'prerender-home',
  apply: 'build' as const,
  async transformIndexHtml(html: string) {
    const bundle = pathToFileURL(path.resolve(import.meta.dirname, 'dist-ssr/entry-server.js')).href
    const { renderHome } = (await import(bundle)) as { renderHome: () => string }
    return injectMarkup(html, { markup: renderHome(), themeScript, routeHideScript, routeGuardScript })
  },
})

let githash = process.env.RAILWAY_GIT_COMMIT_SHA
if (!githash) {
  try {
    githash = child_process.execSync('git rev-parse HEAD').toString().trim()
  } catch {
    // console.error(err)
  }
}
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        'process.env.PUBLIC_BASE_URL': JSON.stringify(process.env.PUBLIC_BASE_URL ?? ''),
        'process.env.PUBLIC_NODE_ENV': JSON.stringify(process.env.PUBLIC_NODE_ENV),
        'process.env.VITE_GITHUB_CLIENT_ID': JSON.stringify(process.env.VITE_GITHUB_CLIENT_ID ?? ''),
        'process.env.PUBLIC_VERSION': JSON.stringify([pkg.version, githash, new Date().toISOString()].join('_')),
      },
    }),
    tailwindcss(),
    prerenderHome(),
    react(),
  ],
  base: './',
  server: {
    proxy: process.env.PUBLIC_BASE_URL
      ? undefined
      : {
          '/image': { target: 'http://localhost:3456', changeOrigin: true },
          '/list': { target: 'http://localhost:3456', changeOrigin: true },
          '/token': { target: 'http://localhost:3456', changeOrigin: true },
          '/api': { target: 'http://localhost:3456', changeOrigin: true },
          '/openapi.json': { target: 'http://localhost:3456', changeOrigin: true },
          '/networks': { target: 'http://localhost:3456', changeOrigin: true },
          '/stats': { target: 'http://localhost:3456', changeOrigin: true },
          '/sprite': { target: 'http://localhost:3456', changeOrigin: true },
        },
  },
  preview: {
    allowedHosts: ['gib.show', 'staging.gib.show', 'healthcheck.railway.app'],
  },
  build: {
    // The server bundle is a build input, not a site: it needs none of the public files.
    copyPublicDir: !isSsrBuild,
    target: 'esnext',
  },
  resolve: {
    alias: {
      $public: './public',
      $images: './src/images',
      $lib: './src/lib',
    },
  },
}))
