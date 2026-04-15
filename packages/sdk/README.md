# @gibs/sdk

TypeScript SDK for the [Gib.Show](https://gib.show) token metadata and image API.

## Install

```bash
yarn add @gibs/sdk
```

## Usage

### Client

```ts
import { createClient } from '@gibs/sdk'

// Production (default)
const client = createClient()

// Staging
const client = createClient({ staging: true })

// Custom URL
const client = createClient({ baseUrl: 'http://localhost:3000' })
```

### Token images

```ts
import { getImageUrl, getThumbnailUrl } from '@gibs/sdk'

// Basic URL
getImageUrl('https://gib.show', 1, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')
// => https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599

// With resize + format
getImageUrl('https://gib.show', 1, '0x2260...', { width: 64, height: 64, format: 'webp' })

// Retina-ready thumbnail (2x size, WebP)
getThumbnailUrl('https://gib.show', 1, '0x2260...', 32)
// => .../image/1/0x2260...?w=64&h=64&format=webp

// Via client
const url = client.imageUrl(1, '0x2260...', { width: 72, format: 'webp' })
```

### Token lists

```ts
// Fetch a token list
const list = await client.fetchTokenList('piteas', 'exchange')
const filtered = await client.fetchTokenList('piteas', 'exchange', 369) // by chain

// Fetch supported networks
const networks = await client.fetchNetworks()

// Fetch all available lists
const lists = await client.fetchLists()
```

### URL builders (standalone)

```ts
import { getTokenListUrl, getNetworksUrl, getListIndexUrl } from '@gibs/sdk'

getTokenListUrl('https://gib.show', 'piteas', 'exchange')       // /list/piteas/exchange
getTokenListUrl('https://gib.show', 'piteas', 'exchange', 369)  // /list/piteas/exchange?chainId=369
getNetworksUrl('https://gib.show')                               // /networks
getListIndexUrl('https://gib.show')                              // /list
```

## API

### `createClient(options?)`

| Option    | Type      | Default              | Description          |
|-----------|-----------|----------------------|----------------------|
| `baseUrl` | `string`  | `https://gib.show`   | Custom API base URL  |
| `staging` | `boolean` | `false`              | Use staging server   |

### `ImageOptions`

| Option        | Type                               | Description              |
|---------------|------------------------------------|--------------------------|
| `width`       | `number`                           | Target width (1-2048)    |
| `height`      | `number`                           | Target height (1-2048)   |
| `format`      | `'webp' \| 'png' \| 'jpg' \| 'avif'` | Output format         |
| `providerKey` | `string`                           | Filter by provider       |
| `listKey`     | `string`                           | Filter by list           |
