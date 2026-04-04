import react from '@vitejs/plugin-react'
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
    react(),
  ],
  base: './',
  server: {
    proxy: process.env.PUBLIC_BASE_URL ? undefined : {
      '/image': { target: 'http://localhost:3456', changeOrigin: true },
      '/list': { target: 'http://localhost:3456', changeOrigin: true },
      '/token': { target: 'http://localhost:3456', changeOrigin: true },
      '/api': { target: 'http://localhost:3456', changeOrigin: true },
    },
  },
  preview: {
    allowedHosts: ['gib.show', 'staging.gib.show', 'healthcheck.railway.app'],
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
