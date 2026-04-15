# Gib.Show API Reference

Gib.Show is a decentralized token metadata and image API. All endpoints are public, no auth required.

**Base URL**: `https://gib.show` (production) or `https://staging.gib.show` (staging)

## Image Endpoints

### Get Token Image
```
GET /image/{chainId}/{address}
```
Returns the highest-priority image for a token. Supports optional resize and format conversion.

**Path params:**
- `chainId` — EVM chain ID (e.g., `1` for Ethereum, `369` for PulseChain)
- `address` — Token contract address (0x...)

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `w` | int (1-2048) | — | Target width in pixels |
| `h` | int (1-2048) | — | Target height in pixels |
| `format` | string | original | Output format: `webp`, `png`, `jpg`, `avif` |
| `providerKey` | string | — | Filter by provider (e.g., `trustwallet`, `coingecko`) |
| `listKey` | string | — | Filter by list key |
| `mode` | string | `save` | `save` returns binary, `link` returns redirect |

**Resize behavior:**
- `w` only → proportional resize
- `h` only → proportional resize
- `w` + `h` → fit within bounds, preserve aspect ratio
- No upscaling — if source is smaller than requested, original is served
- SVGs with `viewBox` pass through as-is (resolution-independent)
- SVGs without `viewBox` are rasterized to PNG
- `format` without `w`/`h` → transcode at original dimensions

**Response headers:**
- `x-resize: original` — no resize applied
- `x-resize: WxH` — resized to these dimensions
- `x-resize: transcoded` — format conversion only
- `x-uri` — original source URL of the image

**Examples:**
```bash
# Original image
curl https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599

# 72x72 WebP (optimal for thumbnails)
curl https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=72&h=72&format=webp

# Network/chain logo
curl https://gib.show/image/1

# PulseChain token
curl https://gib.show/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27
```

### Get Network Image
```
GET /image/{chainId}
```
Returns the chain/network logo. Supports the same resize params.

### Get Image by Hash
```
GET /image/direct/{imageHash}.{ext}
```
Direct access by image hash. Bypasses priority ordering.

### Get Image with Fallback
```
GET /image/fallback/{order}/{chainId}/{address}
```
Tries ordered priority first, falls back to any available image.

### Batch Image Lookup
```
GET /image?i={chainId}/{address}&i={chainId}/{address}
```
Returns the first matching image from multiple specs.

## List Endpoints

### Get All Lists
```
GET /list
```
Returns all available token lists with provider, chain, and version info.

### Get Specific List
```
GET /list/{providerKey}/{listKey}?chainId={chainId}
```
Returns a token list in Uniswap Token List standard format.

**Examples:**
```bash
# All lists
curl https://gib.show/list

# PulseChain tokens from Piteas
curl https://gib.show/list/piteas/exchange?chainId=369

# Ethereum tokens from TrustWallet
curl https://gib.show/list/trustwallet/wallet-ethereum
```

## Network Endpoints

### Get Supported Networks
```
GET /networks
```
Returns all supported EVM networks with chain IDs and image hashes.

## Integration Examples

### React Component
```tsx
function TokenIcon({ chainId, address, size = 32 }) {
  return (
    <img
      src={`https://gib.show/image/${chainId}/${address}?w=${size * 2}&h=${size * 2}&format=webp`}
      width={size}
      height={size}
      alt=""
      style={{ borderRadius: '50%' }}
    />
  )
}
```

### HTML
```html
<img
  src="https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&format=webp"
  width="32"
  height="32"
  alt="WBTC"
/>
```

### Optimal Sizes for Common Use Cases
| Use Case | Recommended | URL Suffix |
|----------|-------------|------------|
| Tiny icon (16px) | 32x32 WebP | `?w=32&h=32&format=webp` |
| List item (24px) | 48x48 WebP | `?w=48&h=48&format=webp` |
| Card (32-48px) | 96x96 WebP | `?w=96&h=96&format=webp` |
| Hero/detail (64-128px) | 256x256 PNG | `?w=256&h=256` |
| Full size | No params | (original) |

Request 2x the CSS display size for Retina displays.

## Image Priority System

When multiple providers have images for the same token, Gib.Show serves the best one:

1. **SVGs always win** — resolution-independent, smallest file size
2. **Provider ranking** — trusted providers (TrustWallet, smoldapp) rank higher than aggregators
3. **Version ordering** — newer list versions preferred
4. **Fallback** — if the priority image is unavailable, next-best is served

## Supported Chains

Major chains include Ethereum (1), PulseChain (369), Arbitrum (42161), Polygon (137), BNB (56), Base (8453), Optimism (10), Avalanche (43114), and 200+ more. Use `/networks` to get the full list.

## Caching

- Images are cached at the edge via Cloudflare (`cache-control: public, max-age=86400`)
- Resized variants are cached server-side in PostgreSQL
- First request for a new size incurs ~50ms resize cost; subsequent requests are instant
