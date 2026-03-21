# @gibs/react

React components for [Gib.Show](https://gib.show) token and network images.

## Install

```bash
yarn add @gibs/react @gibs/sdk react
```

## Setup

Wrap your app with `<GibProvider>` to configure the API endpoint:

```tsx
import { GibProvider } from '@gibs/react'

function App() {
  return (
    <GibProvider>
      <MyApp />
    </GibProvider>
  )
}

// Staging
<GibProvider staging>
  <MyApp />
</GibProvider>

// Custom URL
<GibProvider baseUrl="http://localhost:3000">
  <MyApp />
</GibProvider>
```

## Components

### `<TokenImage>`

Renders a token image with automatic Retina sizing and WebP format.

```tsx
import { TokenImage } from '@gibs/react'

<TokenImage chainId={1} address="0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" size={32} />

// Custom format
<TokenImage chainId={1} address="0x2260..." size={48} format="png" />

// Without GibProvider (standalone)
<TokenImage chainId={1} address="0x2260..." baseUrl="https://gib.show" size={32} />
```

### `<NetworkImage>`

Renders a network/chain logo.

```tsx
import { NetworkImage } from '@gibs/react'

<NetworkImage chainId={1} size={24} />
<NetworkImage chainId={369} size={32} format="avif" />
```

### `<GibImage>`

Low-level image component with skeleton loading and lazy loading via IntersectionObserver. Used internally by `TokenImage` and `NetworkImage`.

```tsx
import { GibImage } from '@gibs/react'

<GibImage
  src="https://gib.show/image/1/0x2260...?w=64&h=64&format=webp"
  size={32}
  skeleton
  lazy
  shape="circle"
/>
```

## Props

### `TokenImageProps`

| Prop      | Type                               | Default   | Description                      |
|-----------|------------------------------------|-----------|----------------------------------|
| `chainId` | `number`                           | required  | EVM chain ID                     |
| `address` | `string`                           | required  | Token contract address           |
| `size`    | `number`                           | `32`      | Display size in CSS pixels       |
| `width`   | `number`                           | —         | Override width (instead of size) |
| `height`  | `number`                           | —         | Override height (instead of size)|
| `format`  | `'webp' \| 'png' \| 'jpg' \| 'avif'` | `'webp'` | Image format                    |
| `baseUrl` | `string`                           | —         | Override base URL (skip provider)|

### `NetworkImageProps`

| Prop      | Type                               | Default   | Description                      |
|-----------|------------------------------------|-----------|----------------------------------|
| `chainId` | `number`                           | required  | EVM chain ID                     |
| `size`    | `number`                           | `24`      | Display size in CSS pixels       |
| `format`  | `'webp' \| 'png' \| 'jpg' \| 'avif'` | `'webp'` | Image format                    |
| `baseUrl` | `string`                           | —         | Override base URL (skip provider)|

### `GibImageProps`

| Prop         | Type                  | Default   | Description                          |
|--------------|-----------------------|-----------|--------------------------------------|
| `src`        | `string`              | required  | Image URL                            |
| `size`       | `number`              | `32`      | Display size in CSS pixels           |
| `width`      | `number`              | —         | Override width                       |
| `height`     | `number`              | —         | Override height                      |
| `alt`        | `string`              | `''`      | Alt text                             |
| `skeleton`   | `boolean`             | `true`    | Show placeholder skeleton            |
| `lazy`       | `boolean`             | `true`    | Lazy load via IntersectionObserver   |
| `lazyMargin` | `string`              | `'200px'` | IntersectionObserver rootMargin      |
| `shape`      | `'circle' \| 'rect'`  | `'circle'`| Skeleton shape                       |
| `className`  | `string`              | —         | Additional CSS class                 |
| `style`      | `CSSProperties`       | —         | Additional inline styles             |
| `onError`    | `() => void`          | —         | Called on load failure               |
| `onLoad`     | `() => void`          | —         | Called on load success               |

### `GibProviderProps`

| Prop      | Type      | Default            | Description        |
|-----------|-----------|--------------------|--------------------|
| `baseUrl` | `string`  | `https://gib.show` | Custom API URL     |
| `staging` | `boolean` | `false`            | Use staging server |

### `useGib()`

Hook to access the `GibClient` from context. Must be called within `<GibProvider>`.

```tsx
import { useGib } from '@gibs/react'

function MyComponent() {
  const client = useGib()
  const url = client.imageUrl(1, '0x2260...', { width: 64, format: 'webp' })
}
```
