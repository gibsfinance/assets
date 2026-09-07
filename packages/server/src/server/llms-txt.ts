/**
 * @module llms-txt
 * The body served at /llms.txt, following the llmstxt.org convention: an H1
 * title, a one-line blockquote summary, then linked sections a language
 * model (or any other automated caller) can follow without first reading the
 * interface's JavaScript bundle.
 */
export const LLMS_TXT = `# Gib.Show

> Token metadata, token lists, and token/network images across many blockchains, served over a public, no-authentication HTTP API.

## API

- [OpenAPI definition](https://gib.show/openapi.json): The complete OpenAPI 3.1 definition for every route below, including request and response shapes.
- [Network image](https://gib.show/image/{chainId}): A chain's own icon. Query parameters: \`as\` (convert output format — webp, png, jpg, jpeg, avif), \`w\` and \`h\` (resize in pixels, 1-2048), \`only\` (filter source images by type), \`mode\` (\`mode=link\` redirects to the source URI instead of serving content).
- [Token image](https://gib.show/image/{chainId}/{address}): A token's image, priority-ordered by list ranking. Accepts the same \`as\`, \`w\`, \`h\`, \`only\`, \`mode\` query parameters.
- [Image by content hash](https://gib.show/image/direct/{imageHash}): Content-addressed image access. Accepts \`as\`, \`w\`, \`h\`.
- [Networks](https://gib.show/networks): Every supported network, with its chain id and icon hash.
- [Token lists](https://gib.show/list): Every available token list, with its provider, chain, and version.
- [Token search](https://gib.show/list/search): Search tokens by name, symbol, or address across every chain.
- [Usage statistics](https://gib.show/stats): Per-chain counts of token addresses that have a usable image.
- [Terms](https://gib.show/terms): Terms and attribution — what the service claims, what it does not, and what a caller must do with the images it serves.

## Guides

- [API reference](https://gib.show/skills/api-reference.md): Query parameters, response shapes, and example requests for every route.
- [List management](https://gib.show/skills/list-management.md): How token lists are created, edited, and published through the Studio.
- [Self-hosting](https://gib.show/skills/self-hosting.md): Running your own copy of the service.
`
