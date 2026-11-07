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
import { inlineStylesheet } from './src/prerender/inline-stylesheet.ts'
import { killWorkerSource } from './src/sw/kill-worker.ts'
import { routeLoaderMarkup } from './src/prerender/route-loader.ts'

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
    return injectMarkup(html, {
      markup: renderHome(),
      themeScript,
      routeHideScript,
      routeGuardScript,
      routeLoader: routeLoaderMarkup,
    })
  },
})

/**
 * Replaces the stylesheet link in the built `index.html` with the stylesheet itself,
 * so first paint needs no second request. Runs after Vite has added the link, and a
 * build with no link to replace fails. The hashed file is still emitted, unused.
 */
const inlineCss = () => ({
  name: 'inline-stylesheet',
  apply: 'build' as const,
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, context: { bundle?: Record<string, { type: string; source?: string | Uint8Array }> }) {
      const bundle = context.bundle
      if (!bundle) throw new Error('inline-stylesheet needs the bundle, which only a build has')
      return inlineStylesheet(html, (href) => {
        const file = bundle[href.replace(/^\.\//, '')]
        return file?.type === 'asset' ? String(file.source) : undefined
      })
    },
  },
})

/**
 * Writes `/sw.js` at the site root under a fixed name: browsers find a worker by its
 * address, so it must not be hashed. Building with `VITE_SERVICE_WORKER=off` writes the
 * kill switch there instead (see `src/sw/kill-worker.ts`).
 */
const serviceWorker = () => ({
  name: 'service-worker',
  apply: 'build' as const,
  buildStart(this: { emitFile: (file: object) => string }) {
    if (process.env.VITE_SERVICE_WORKER === 'off') {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: killWorkerSource })
      return
    }
    this.emitFile({ type: 'chunk', fileName: 'sw.js', id: path.resolve(import.meta.dirname, 'src/sw/sw.ts') })
  },
})

let githash = process.env.GIT_COMMIT_SHA
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
    inlineCss(),
    ...(isSsrBuild ? [] : [serviceWorker()]),
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
    allowedHosts: ['gib.show', 'staging.gib.show'],
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
