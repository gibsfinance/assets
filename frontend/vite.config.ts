/// <reference types="@sveltejs/kit" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { skeleton } from '@skeletonlabs/tw-plugin';

export default defineConfig({
	plugins: [
		sveltekit(),
		skeleton({
			themes: { preset: ['skeleton'] }
		})
	],
	build: {
		rollupOptions: {
			output: {
				manualChunks: undefined
			}
		},
		target: 'esnext'
	},
	define: {
		'process.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || 'https://gib.show')
	}
});
