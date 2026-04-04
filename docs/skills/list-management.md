# Token List Management

Create, edit, and publish token lists using the Gib.Show Studio.

## Overview

The Studio at `https://gib.show/#/studio` provides a visual editor for token lists. Lists are stored locally in your browser (IndexedDB) and can be published to your own GitHub repository.

## Creating Lists

### From Scratch
1. Open Studio → click the **+** button in the sidebar
2. Click "New List"
3. Add tokens by pasting addresses
4. Use "Load RPC" to auto-fetch name, symbol, and decimals from the chain

### Fork an Existing List
1. Browse tokens in the Studio
2. Click a list name (e.g., `piteas/exchange`) in any token row
3. Click "Fork [list name]"
4. Edit the local copy — add/remove tokens, reorder, change images

### Import from URL
1. Open the editor → "Import from URL"
2. Paste any Uniswap Token List standard URL
3. The list is fetched, parsed, and stored locally

### Paste JSON
1. Open the editor → "Paste JSON"
2. Paste raw JSON in Uniswap Token List format
3. Supports both `{ tokens: [...] }` and bare token arrays

## Token List Format

Gib.Show uses the [Uniswap Token List](https://tokenlists.org/) standard:

```json
{
  "name": "My Token List",
  "timestamp": "2026-03-21T00:00:00.000Z",
  "version": { "major": 1, "minor": 0, "patch": 0 },
  "tokens": [
    {
      "chainId": 1,
      "address": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      "name": "Wrapped BTC",
      "symbol": "WBTC",
      "decimals": 8,
      "logoURI": "https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
    }
  ]
}
```

## Image Management

Each token can have a custom image:
- Click the token's image in the editor to open the image manager
- Upload a local file (SVG, PNG, WebP, JPG)
- Set a remote URL
- Preview at multiple sizes (32, 64, 128, 256px)
- Format indicator shows SVG/PNG/WebP

Images use the server's resize endpoint for previews: `?w=N&h=N&format=webp`

## RPC Metadata Loading

The editor can fetch token metadata directly from the blockchain:
- Uses viem's `readContract` with ERC-20 ABI
- Reads `name()`, `symbol()`, `decimals()` for each token
- Supports all viem built-in chains + custom RPC URLs
- Custom RPCs stored per chain ID in localStorage

To add a custom RPC (e.g., for PulseChain):
```javascript
localStorage.setItem('gib-custom-rpcs', JSON.stringify({
  369: 'https://rpc.pulsechain.com'
}))
```

## Publishing

Lists can be published to your own GitHub repository:
1. Click "Publish" in the editor header
2. Authenticate with GitHub (OAuth)
3. The list is pushed as `tokenlist.json` to a new or existing repo
4. The repo URL is returned for sharing

The publish system is pluggable — GitLab and other VCS providers can be added.

## Token Discovery

### Browsing
- Select a chain from the popular chains grid or dropdown
- Browse paginated token list with search
- Filter by provider lists (toggle specific providers on/off)

### Token Deduplication
When multiple lists have the same token:
- One row shown with the best image (SVGs preferred)
- Expand chevron reveals all list references
- Each sub-row shows its image, format badge, and links

### Global Search
- Type a query and press Enter for cross-chain search
- Searches across all lists and chains
- Results sorted by chain (Ethereum first) then name

## Supported Chains

The Studio shows the top chains by token count. Use the dropdown to access all 200+ supported chains. Toggle "Show Testnets" for test networks.

## Local Storage

Lists are stored in IndexedDB (not localStorage) to handle large lists without hitting size limits. Each list is stored under the key `gib-list:{uuid}`.

Data persists across browser sessions but is lost if browser data is cleared. Use the Publish feature to back up important lists.
