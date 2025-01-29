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
