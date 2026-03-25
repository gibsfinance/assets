export interface AttributionProvider {
  name: string
  link: string
  imageUrl: string
}

export const attributionProviders: AttributionProvider[] = [
  {
    name: 'Dexscreener',
    link: 'https://dexscreener.com',
    imageUrl: 'dexscreener.svg',
  },
  {
    name: 'Coingecko',
    link: 'https://coingecko.com',
    imageUrl: 'coingecko.svg',
  },
  {
    name: 'Uniswap',
    link: 'https://uniswap.org',
    imageUrl: 'uniswap.svg',
  },
  {
    name: 'PulseChain',
    link: 'https://pulsechain.com',
    imageUrl: 'pulsechain.svg',
  },
  {
    name: 'PulseX',
    link: 'https://app.pulsex.com/',
    imageUrl: 'pulsex.svg',
  },
  {
    name: 'Balancer',
    link: 'https://balancer.fi',
    imageUrl: 'balancer.svg',
  },
  {
    name: 'Internet Money',
    link: 'https://internetmoney.io',
    imageUrl: 'https://im-wallet.herokuapp.com/icons/time.png',
  },
  // PumpTires disabled — API down
  {
    name: 'Trust Wallet',
    link: 'https://trustwallet.com',
    imageUrl: 'trustwallet.svg',
  },
  {
    name: 'TokenSex',
    link: 'https://tokensex.com',
    imageUrl: 'tokensex.svg',
  },
  {
    name: 'UMA',
    link: 'https://uma.xyz',
    imageUrl: 'uma.svg',
  },
  {
    name: 'Optimism',
    link: 'https://optimism.io',
    imageUrl: 'optimism.svg',
  },
  {
    name: 'PLS369',
    link: 'https://pls369.com',
    imageUrl: 'pls369.svg',
  },
  {
    name: 'Etherscan',
    link: 'https://etherscan.io',
    imageUrl: 'etherscan.svg',
  },
  {
    name: 'RouteScan',
    link: 'https://routescan.io',
    imageUrl: 'routescan.svg',
  },
  {
    name: 'Smoldapp',
    link: 'https://smold.app',
    imageUrl: 'smoldapp.svg',
  },
]
