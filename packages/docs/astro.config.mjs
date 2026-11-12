import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi'

/** Where the site is served. Set `DOCS_SITE_URL` for staging; production is the default. */
const site = process.env['DOCS_SITE_URL'] || 'https://docs.gib.show'

/** Sidebar groups that fill themselves from a content directory, in the order shown. */
const guideGroups = [
  { label: 'Getting started', directory: 'getting-started' },
  { label: 'API guide', directory: 'api-reference' },
  { label: 'List management', directory: 'list-management' },
  { label: 'Self-hosting', directory: 'self-hosting' },
  { label: 'Contributing', directory: 'contributing' },
].map(({ label, directory }) => ({ label, items: [{ autogenerate: { directory } }] }))

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: 'gib.show docs',
      description:
        'Guides, the endpoint reference and contributor notes for gib.show, the token image and token list service.',
      favicon: '/favicon.png',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/gibsfinance/assets' }],
      editLink: { baseUrl: 'https://github.com/gibsfinance/assets/edit/master/packages/docs/' },
      customCss: ['./src/styles/theme.css'],
      plugins: [
        // The generated file is written by scripts/generate-openapi.ts from the server's own definition.
        starlightOpenAPI([{ base: 'reference', label: 'Endpoint reference', schema: './generated/openapi.json' }]),
        starlightLlmsTxt({
          projectName: 'gib.show',
          description:
            'Token metadata, token lists and token and network images across many blockchains, over a public HTTP API.',
        }),
      ],
      sidebar: [...guideGroups, ...openAPISidebarGroups],
    }),
  ],
})
