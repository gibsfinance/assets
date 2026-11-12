/**
 * @module fixtures
 * Sample data for stories. Nothing here is fetched: every image is a data address and every
 * list is written out, so a story renders the same offline and in the published site.
 */
import type { LocalToken } from '../hooks/useLocalLists'
import type { ListDescription, Network, TokenListReference } from '../types'
import type { MockApiRoutes } from './mock-api'

/**
 * Draw a round token icon as a data address.
 *
 * @param letter One character shown in the middle.
 * @param color The fill of the circle.
 */
export const tokenIconDataUri = (letter: string, color: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${color}"/>` +
      `<text x="32" y="42" font-family="sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
  )}`

/** Icons used by the image stories. */
export const SAMPLE_ICONS = {
  green: tokenIconDataUri('G', '#00b368'),
  blue: tokenIconDataUri('B', '#0ea5e9'),
  purple: tokenIconDataUri('P', '#7c3aed'),
} as const

/** A token row as the list editor holds it. */
export const SAMPLE_TOKEN: LocalToken = {
  chainId: 369,
  address: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
  name: 'Wrapped Pulse',
  symbol: 'WPLS',
  decimals: 18,
  imageUri: SAMPLE_ICONS.green,
  order: 0,
}

/** A token with no image yet, so the row shows the upload widget. */
export const SAMPLE_TOKEN_WITHOUT_IMAGE: LocalToken = {
  ...SAMPLE_TOKEN,
  imageUri: undefined,
  symbol: 'NOIMG',
  order: 1,
}

/** A token whose name and symbol are far longer than the row. */
export const SAMPLE_TOKEN_WITH_LONG_TEXT: LocalToken = {
  ...SAMPLE_TOKEN,
  name: 'A Very Long Token Name That Keeps Going Past The End Of The Row To Test Truncation',
  symbol: 'LONGSYMBOLTHATWRAPS',
  order: 2,
}

/** Where a token's image came from, for the sub-row tree. */
export const SAMPLE_REFERENCES: TokenListReference[] = [
  { sourceList: 'coingecko', imageUri: SAMPLE_ICONS.green, imageFormat: 'png' },
  { sourceList: 'trustwallet', imageUri: SAMPLE_ICONS.blue, imageFormat: 'png' },
  { sourceList: 'uniswap-default', imageUri: SAMPLE_ICONS.purple, imageFormat: 'svg' },
]

/** What `/networks` answers. */
export const SAMPLE_NETWORKS: Network[] = [
  {
    type: 'evm',
    chainId: '1',
    networkId: '1',
    chainIdentifier: 'eip155-1',
    name: 'Ethereum Mainnet',
    title: null,
    imageHash: 'a',
  },
  {
    type: 'evm',
    chainId: '369',
    networkId: '369',
    chainIdentifier: 'eip155-369',
    name: 'PulseChain',
    title: null,
    imageHash: 'b',
  },
  {
    type: 'evm',
    chainId: '10',
    networkId: '10',
    chainIdentifier: 'eip155-10',
    name: 'OP Mainnet',
    title: null,
    imageHash: 'c',
  },
  {
    type: 'evm',
    chainId: '56',
    networkId: '56',
    chainIdentifier: 'eip155-56',
    name: 'BNB Smart Chain',
    title: null,
    imageHash: 'd',
  },
  {
    type: 'evm',
    chainId: '8453',
    networkId: '8453',
    chainIdentifier: 'eip155-8453',
    name: 'Base',
    title: null,
    imageHash: 'e',
  },
  {
    type: 'evm',
    chainId: '11155111',
    networkId: '11155111',
    chainIdentifier: 'eip155-11155111',
    name: 'Sepolia Testnet',
    title: null,
    imageHash: null,
  },
]

/** What `/stats` answers: token counts per chain. */
export const SAMPLE_STATS = [
  { chainId: '1', chainIdentifier: 'eip155-1', count: 4200 },
  { chainId: '369', chainIdentifier: 'eip155-369', count: 1900 },
  { chainId: '10', chainIdentifier: 'eip155-10', count: 800 },
  { chainId: '56', chainIdentifier: 'eip155-56', count: 2600 },
  { chainId: '8453', chainIdentifier: 'eip155-8453', count: 1100 },
]

/** What `/list` answers. */
export const SAMPLE_PROVIDERS: ListDescription[] = []

/** Fixtures for every request the network picker makes: the happy path. */
export const NETWORK_ROUTES: MockApiRoutes = {
  '/networks': { kind: 'json', body: SAMPLE_NETWORKS },
  '/stats': { kind: 'json', body: SAMPLE_STATS },
  '/list': { kind: 'json', body: SAMPLE_PROVIDERS },
}

/** The same requests, never answered: the picker's loading state. */
export const PENDING_NETWORK_ROUTES: MockApiRoutes = {
  '/networks': { kind: 'never' },
  '/stats': { kind: 'never' },
  '/list': { kind: 'never' },
}

/** The same requests, all refused: the picker's error state. */
export const FAILING_NETWORK_ROUTES: MockApiRoutes = {
  '/networks': { kind: 'json', status: 500, body: { error: 'boom' } },
  '/stats': { kind: 'json', status: 500, body: { error: 'boom' } },
  '/list': { kind: 'json', status: 500, body: { error: 'boom' } },
}
