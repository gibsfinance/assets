/// <reference types="@sveltejs/kit" />
import { skeleton } from '@skeletonlabs/tw-plugin'
import { sveltekit } from '@sveltejs/kit/vite'
import type { PluginOption } from 'vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    sveltekit(),
    skeleton({
      themes: { preset: ['skeleton'] },
    }) as unknown as PluginOption,
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
    target: 'esnext',
  },
  define: {
    'process.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || 'https://gib.show'),
    'process.env.VITE_API_LOCAL': JSON.stringify(process.env.VITE_API_LOCAL || 'http://localhost:3000'),
  },
})
