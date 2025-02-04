# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.



# API Endpoints & Capabilities

1. Token Information

- `/token/{chainId}/{tokenAddress}` - Get specific token information
- `/list/{listName}` - Get full token list (e.g. 9mm list)
- `/list/{listName}?chainId={chainId}` - Get filtered token list for specific chain
- `/list/{listName}?chainId={chainId}&address={tokenAddress}` - Get token list filtered by chain and address

2. Image Endpoints

- `/image/{chainId}` - Get network/chain images
- `/image/{chainId}/{tokenAddress}` - Get token images
- `/image/fallback/default/{chainId}/{tokenAddress}` - Get fallback token images
- `/image/direct/{hash}` - Get direct image access via hash

# Assets Project Functionality

1. Database Operations (`/src/db`)

- Token data storage and retrieval
- Configuration management
- Database connection handling

2. Token Collection (`/src/collect`)

- Remote token list fetching
- ERC20 token data reading
- Token information aggregation

3. Server Components

- Image handling and serving
- Token statistics processing
- API request handling

4. Utility Functions (`/src/utils`)

- ERC20 contract reading
- Token data validation
- Network/chain utilities

5. Components

- Network token display
- Token dashboard
- Token statistics visualization
- Token timeline tracking

6. Hooks

- `useTokenStats` - Custom hook for token statistics

7. Configuration

- Environment variable management
- Docker configuration
- Database configuration

8. Features

- Token list management
- Token image serving and caching
- Token statistics tracking
- Network/chain support
- Token data aggregation
- API endpoint handling

The project appears to be a backend service that:

1. Collects and manages token information
2. Serves token and network images
3. Provides API endpoints for token data
4. Tracks and serves token statistics
5. Manages token lists
6. Handles caching and fallback mechanisms for images
7. Supports multiple blockchain networks/chains

Would you like me to elaborate on any specific aspect of the API or the assets project?


# Token Lists Overview (144 unique lists)

| Name | Provider | Chain ID | Type | Default |
|------|----------|----------|------|---------|
| 1inch default token list | uniswap-1-inch | 0 | hosted | ✓ |
| Balancer | balancer | 0 | exchange | ✓ |
| Compound | compound | 0 | exchange | ✓ |
| Compound | uniswap-compound | 0 | hosted | ✓ |
| Default list | dfyn | 0 | exchange | ✓ |
| Defiprime | uniswap-defiprime | 0 | hosted | ✓ |
| Honeyswap Default | honeyswap | 0 | exchange | ✓ |
| Kleros Tokens | kleros | 0 | exchange | ✓ |
| Quickswap Token List | quickswap | 0 | exchange | ✓ |
| Scroll Token List | scroll | 0 | network | ✓ |
| Superchain Token List | uniswap-optimism | 0 | hosted | ✓ |
| Superchain Token List | optimism | 0 | network | ✓ |
| Token Name Service | uniswap-tokendao | 0 | hosted | ✓ |
| Uniswap Labs Default | uniswap-uniswap-default-list | 0 | hosted | ✓ |
| default wallet list | internetmoney | 0 | wallet | - |
| 1inch | uniswap-1-inch | 1 | hosted | ✓ |
| Aave Token List | uniswap-aave-token-list | 1 | hosted | ✓ |
| Agora dataFi Tokens | uniswap-agora-datafi-tokens | 1 | hosted | ✓ |
| BA ERC20 SEC Action | uniswap-blockchain-association-sec-non-compliant-list | 1 | hosted | ✓ |
| CMC DeFi | uniswap-cmc-defi | 1 | hosted | ✓ |
| CMC Stablecoin | uniswap-cmc-stablecoin | 1 | hosted | ✓ |
| CMC200 ERC20 | uniswap-cmc-200-erc-20 | 1 | hosted | ✓ |
| CoinGecko | coingecko | 1 | uniswap | ✓ |
| Dharma Token List | uniswap-dharma-token-list | 1 | hosted | ✓ |
| Furucombo | uniswap-furucombo | 1 | hosted | ✓ |
| Gemini Token List | uniswap-gemini-token-list | 1 | hosted | ✓ |
| Messari Verified | uniswap-messari-verified | 1 | hosted | ✓ |
| MyCrypto Token List | uniswap-mycrypto | 1 | hosted | ✓ |
| Roll Social Money | roll | 1 | exchange | ✓ |
| Roll Social Money | uniswap-roll-social-money | 1 | hosted | ✓ |
| Set | uniswap-set-protocol | 1 | hosted | ✓ |
| Set | set | 1 | exchange | ✓ |
| Synthetix | uniswap-synthetix | 1 | hosted | ✓ |
| UMA | uma | 1 | exchange | ✓ |
| Uniswap Token Pairs | uniswap-uniswap-token-pairs | 1 | hosted | ✓ |
| Wrapped Tokens | uniswap-wrapped-tokens | 1 | hosted | ✓ |
| Zerion | uniswap-zerion-explore | 1 | hosted | ✓ |
| default wallet list for chain 1 | internetmoney | 1 | wallet-1 | - |
| wallet-ethereum | trustwallet | 1 | wallet-ethereum | - |
| - | smoldapp | 1 | tokens-1-png128 | - |
| - | pulsechain-bridge | 1 | foreign | - |
| default wallet list for chain 10 | internetmoney | 10 | wallet-10 | - |
| - | smoldapp | 10 | tokens-10-pngalt-128 | - |
| Levinswap Default | levinswap | 100 | exchange | ✓ |
| default wallet list for chain 100 | internetmoney | 100 | wallet-100 | - |
| xDAI Default | baofinance | 100 | xdai | ✓ |
| - | smoldapp | 100 | tokens-100-svg | - |
| default wallet list for chain 10001 | internetmoney | 10001 | wallet-10001 | - |
| - | smoldapp | 1030 | tokens-1030-svg | - |
| - | smoldapp | 1088 | tokens-1088-svg | - |
| default wallet list for chain 109 | internetmoney | 109 | wallet-109 | - |
| default wallet list for chain 1101 | internetmoney | 1101 | wallet-1101 | - |
| - | smoldapp | 1101 | tokens-1101-svg | - |
| default wallet list for chain 11155111 | internetmoney | 11155111 | wallet-11155111 | - |
| - | testnet-v4-pulsechain-bridge | 11155111 | foreign | - |
| - | smoldapp | 11155111 | tokens-11155111-png128 | - |
| - | smoldapp | 1135 | tokens-1135-png128 | - |
| - | smoldapp | 1151111081099710 | tokens-1151111081099710-svg | - |
| default wallet list for chain 1209 | internetmoney | 1209 | wallet-1209 | - |
| - | smoldapp | 122 | tokens-122-svg | - |
| default wallet list for chain 1284 | internetmoney | 1284 | wallet-1284 | - |
| default wallet list for chain 1285 | internetmoney | 1285 | wallet-1285 | - |
| - | smoldapp | 1313161554 | tokens-1313161554-svg | - |
| default wallet list for chain 137 | internetmoney | 137 | wallet-137 | - |
| wallet-polygon | trustwallet | 137 | wallet-polygon | - |
| - | smoldapp | 137 | tokens-137-png128 | - |
| - | smoldapp | 1380012617 | tokens-1380012617-png128 | - |
| default wallet list for chain 14 | internetmoney | 14 | wallet-14 | - |
| - | smoldapp | 1750 | tokens-1750-png32 | - |
| default wallet list for chain 17777 | internetmoney | 17777 | wallet-17777 | - |
| wallet-meter | trustwallet | 18000 | wallet-meter | - |
| default wallet list for chain 2000 | internetmoney | 2000 | wallet-2000 | - |
| default wallet list for chain 202212 | internetmoney | 202212 | wallet-202212 | - |
| default wallet list for chain 2222 | internetmoney | 2222 | wallet-2222 | - |
| - | smoldapp | 223 | tokens-223-png128 | - |
| default wallet list for chain 25 | internetmoney | 25 | wallet-25 | - |
| default wallet list for chain 250 | internetmoney | 250 | wallet-250 | - |
| wallet-fantom | trustwallet | 250 | wallet-fantom | - |
| - | smoldapp | 250 | tokens-250-pngalt-128 | - |
| - | smoldapp | 252 | tokens-252-png32 | - |
| - | smoldapp | 314 | tokens-314-svg | - |
| CoinGecko | coingecko | 324 | zksync | ✓ |
| default wallet list for chain 324 | internetmoney | 324 | wallet-324 | - |
| wallet-zksync | trustwallet | 324 | wallet-zksync | - |
| - | smoldapp | 324 | tokens-324-png128 | - |
| default wallet list for chain 32520 | internetmoney | 32520 | wallet-32520 | - |
| - | smoldapp | 34443 | tokens-34443-svg | - |
| default wallet list for chain 361 | internetmoney | 361 | wallet-361 | - |
| - | pulsex | 369 | inline | ✓ |
| 9mm default Tokens List | 9mm | 369 | exchange | ✓ |
| Piteas Tokens | piteas | 369 | exchange | ✓ |
| Pulse | phux | 369 | exchange | ✓ |
| PulseX Extended | pulsex | 369 | extended | - |
| default wallet list for chain 369 | internetmoney | 369 | wallet-369 | - |
| pls369 | pls369 | 369 | repo | ✓ |
| - | tokensex-bridge | 369 | home | ✓ |
| - | pulsechain-bridge | 369 | home | ✓ |
| default wallet list for chain 40 | internetmoney | 40 | wallet-40 | - |
| - | smoldapp | 420 | tokens-420-png128 | - |
| default wallet list for chain 4200 | internetmoney | 4200 | wallet-4200 | - |
| CoinGecko | coingecko | 42161 | arbitrum-one | ✓ |
| default wallet list for chain 42161 | internetmoney | 42161 | wallet-42161 | - |
| - | smoldapp | 42161 | tokens-42161-png32 | - |
| default wallet list for chain 42220 | internetmoney | 42220 | wallet-42220 | - |
| - | smoldapp | 42220 | tokens-42220-png128 | - |
| default wallet list for chain 43114 | internetmoney | 43114 | wallet-43114 | - |
| wallet-avalanchec | trustwallet | 43114 | wallet-avalanchec | - |
| - | smoldapp | 43114 | tokens-43114-png128 | - |
| default wallet list for chain 4689 | internetmoney | 4689 | wallet-4689 | - |
| - | smoldapp | 5 | tokens-5-svg | - |
| default wallet list for chain 50 | internetmoney | 50 | wallet-50 | - |
| default wallet list for chain 5000 | internetmoney | 5000 | wallet-5000 | - |
| - | smoldapp | 5000 | tokens-5000-svg | - |
| - | smoldapp | 50104 | tokens-50104-png32 | - |
| - | smoldapp | 534352 | tokens-534352-png32 | - |
| PancakeSwap Default | pancake | 56 | exchange | ✓ |
| default wallet list for chain 56 | internetmoney | 56 | wallet-56 | - |
| wallet-smartchain | trustwallet | 56 | wallet-smartchain | - |
| - | tokensex-bridge | 56 | foreign | - |
| - | smoldapp | 56 | tokens-56-png128 | - |
| default wallet list for chain 57 | internetmoney | 57 | wallet-57 | - |
| - | smoldapp | 57073 | tokens-57073-pngalt-128 | - |
| default wallet list for chain 59144 | internetmoney | 59144 | wallet-59144 | - |
| - | smoldapp | 59144 | tokens-59144-png128 | - |
| - | smoldapp | 60808 | tokens-60808-png128 | - |
| default wallet list for chain 61 | internetmoney | 61 | wallet-61 | - |
| wallet-optimism | trustwallet | 614 | wallet-optimism | - |
| default wallet list for chain 6666 | internetmoney | 6666 | wallet-6666 | - |
| default wallet list for chain 71111 | internetmoney | 71111 | wallet-71111 | - |
| - | smoldapp | 7777777 | tokens-7777777-svg | - |
| default wallet list for chain 81457 | internetmoney | 81457 | wallet-81457 | - |
| - | smoldapp | 81457 | tokens-81457-png32 | - |
| default wallet list for chain 8453 | internetmoney | 8453 | wallet-8453 | - |
| wallet-base | trustwallet | 8453 | wallet-base | - |
| - | smoldapp | 8453 | tokens-8453-png32 | - |
| - | smoldapp | 84531 | tokens-84531-png128 | - |
| default wallet list for chain 8787 | internetmoney | 8787 | wallet-8787 | - |
| default wallet list for chain 88888 | internetmoney | 88888 | wallet-88888 | - |
| wallet-arbitrum | trustwallet | 9001 | wallet-arbitrum | - |
| default wallet list for chain 943 | internetmoney | 943 | wallet-943 | - |
| v4pls943 | pls369 | 943 | repo-testnet | - |
| - | testnet-v4-pulsechain-bridge | 943 | home | ✓ |
| - | smoldapp | 957 | tokens-957-svg | - |
| - | smoldapp | 97 | tokens-97-png32 | - |