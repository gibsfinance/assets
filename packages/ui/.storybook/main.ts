import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Plugins in `vite.config.ts` that only make sense for a production build of the
 * application itself. The prerender plugin imports a server bundle that Storybook
 * never builds, the stylesheet inliner needs the application's `index.html`, and the
 * service worker belongs to the application's scope. Storybook builds its own page, so
 * each of them is removed by name.
 */
const APPLICATION_ONLY_PLUGINS = new Set(['prerender-home', 'inline-stylesheet', 'service-worker'])

/** Whether a Vite plugin entry is one of the application-only plugins above. */
const isApplicationOnlyPlugin = (plugin: unknown): boolean =>
  typeof plugin === 'object' &&
  plugin !== null &&
  'name' in plugin &&
  APPLICATION_ONLY_PLUGINS.has((plugin as { name: string }).name)

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  // Storybook reads the application's `vite.config.ts` on its own, so the Tailwind plugin,
  // the `$lib` aliases and the build-time constants are shared with the real interface.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: (viteConfig.plugins ?? []).flat().filter((plugin) => !isApplicationOnlyPlugin(plugin)),
  }),
}

export default config
