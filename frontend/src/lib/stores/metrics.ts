import { writable } from 'svelte/store';
import type { PlatformMetrics, TokenInfo } from '$lib/types';

// Define supported chains for display (removing testnet)
const DISPLAY_CHAIN_INFO = [
	{ chainId: 369, name: 'PulseChain', rpcUrl: 'https://rpc-pulsechain.g4mm4.io' },
	{ chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
	{ chainId: 56, name: 'BNB Smart Chain', rpcUrl: 'https://bsc-dataseed.binance.org' },
	{ chainId: 137, name: 'Polygon', rpcUrl: 'https://polygon-rpc.com' },
	{ chainId: 42161, name: 'Arbitrum One', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
	{ chainId: 10, name: 'Optimism', rpcUrl: 'https://mainnet.optimism.io' },
	{ chainId: 100, name: 'Gnosis Chain', rpcUrl: 'https://rpc.gnosischain.com' },
	{ chainId: 324, name: 'zkSync Era', rpcUrl: 'https://mainnet.era.zksync.io' },
	{ chainId: 534352, name: 'Scroll', rpcUrl: 'https://rpc.scroll.io' }
] as const;

// Keep full CHAIN_INFO for other functionality
const CHAIN_INFO = [
	...DISPLAY_CHAIN_INFO,
	{ chainId: 943, name: 'PulseChain Testnet v4', rpcUrl: 'https://rpc.v4.testnet.pulsechain.com' }
] as const;

// List of all token list providers
const TOKEN_LISTS = [
	'9mm',
	'baofinance',
	'coingecko',
	'compound',
	'dfyn',
	'honeyswap',
	'kleros',
	'levinswap',
	'optimism',
	'pancake',
	'quickswap',
	'roll',
	'scroll',
	'set',
	'uma'
] as const;

function createMetricsStore() {
	const { subscribe, set } = writable<PlatformMetrics | null>(null);

	const fetchTokenList = async (provider: string) => {
		try {
			const response = await fetch(`https://gib.show/list/${provider}`);
			if (!response.ok) return [];
			const data = await response.json();
			return data.tokens || [];
		} catch (error) {
			console.error(`Failed to fetch ${provider} list:`, error);
			return [];
		}
	};

	return {
		subscribe,
		fetchMetrics: async () => {
			try {
				// Fetch all token lists in parallel
				const allTokenLists = await Promise.all(
					TOKEN_LISTS.map((provider) => fetchTokenList(provider))
				);

				// Combine all tokens and remove duplicates by chainId + address
				const tokenSet = new Set<string>();
				const allTokens = allTokenLists.flat().filter((token) => {
					const key = `${token.chainId}-${token.address}`;
					if (tokenSet.has(key)) return false;
					tokenSet.add(key);
					return true;
				});

				const metrics: PlatformMetrics = {
					tokenList: {
						total: allTokens.length,
						byChain: DISPLAY_CHAIN_INFO.reduce(
							(acc, chain) => {
								acc[chain.chainId] = allTokens.filter(
									(t: TokenInfo) => Number(t.chainId) === chain.chainId
								).length;
								return acc;
							},
							{} as Record<number, number>
						)
					},
					networks: {
						supported: DISPLAY_CHAIN_INFO.map((chain) => ({
							chainId: chain.chainId,
							name: chain.name,
							isActive: chain.chainId === 369
						})),
						active: 'PulseChain'
					}
				};

				set(metrics);
				console.log('Metrics fetched:', metrics);
			} catch (error) {
				console.error('Failed to fetch metrics:', error);
				set({
					tokenList: {
						total: 0,
						byChain: DISPLAY_CHAIN_INFO.reduce(
							(acc, chain) => {
								acc[chain.chainId] = 0;
								return acc;
							},
							{} as Record<number, number>
						)
					},
					networks: {
						supported: DISPLAY_CHAIN_INFO.map((chain) => ({
							chainId: chain.chainId,
							name: chain.name,
							isActive: chain.chainId === 369
						})),
						active: 'PulseChain'
					}
				});
			}
		}
	};
}

export const metrics = createMetricsStore();
