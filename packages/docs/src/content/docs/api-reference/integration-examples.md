---
title: Integration examples
description: Copy-ready React and HTML snippets, and recommended image sizes.
sidebar:
  order: 14
---

## React component

```tsx
function TokenIcon({ chainId, address, size = 32 }) {
  return (
    <img
      src={`https://gib.show/image/${chainId}/${address}?w=${size * 2}&h=${size * 2}&as=webp`}
      width={size}
      height={size}
      alt=""
      style={{ borderRadius: '50%' }}
    />
  )
}
```

## HTML

```html
<img
  src="https://gib.show/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?w=64&h=64&as=webp"
  width="32"
  height="32"
  alt="WBTC"
/>
```

## Recommended sizes

| Use case | Recommended | URL suffix |
|----------|-------------|------------|
| Tiny icon (16 pixels) | 32 by 32 `webp` | `?w=32&h=32&as=webp` |
| List item (24 pixels) | 48 by 48 `webp` | `?w=48&h=48&as=webp` |
| Card (32 to 48 pixels) | 96 by 96 `webp` | `?w=96&h=96&as=webp` |
| Hero or detail (64 to 128 pixels) | 256 by 256 `png` | `?w=256&h=256` |
| Full size | No parameters | (original) |

Request twice the CSS display size for high-density screens.

## Packages

The repository also holds two npm packages for the same service: `@gibs/sdk`, a client with no runtime dependencies, and `@gibs/react`, which wraps it in React components.
