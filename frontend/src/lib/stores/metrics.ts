import { writable } from 'svelte/store';
import type { PlatformMetrics, TokenInfo } from '$lib/types';
import { getApiUrl } from '$lib/utils';

interface CacheEntry<T> {
	timestamp: number;
	data: T;
	compressed?: boolean;
}

interface Provider {
	key: string;
	name: string;
	description: string;
	default: boolean;
	providerKey: string;
	chainId: string;
}

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MAX_CACHE_SIZE = 4.5 * 1024 * 1024; // 4.5MB
const MAX_ENTRY_SIZE = 500 * 1024; // 500KB for a single entry
const MAX_TOKENS_PER_LIST = 100000; // Increased to handle large token lists

function isCacheValid<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
	if (!cache) return false;
	const now = Date.now();
	return now - cache.timestamp < CACHE_DURATION;
}

// Simple compression by removing unnecessary fields and limiting precision
function compressTokenList(tokens: TokenInfo[]): TokenInfo[] {
	// Don't limit the number of tokens, just normalize addresses
	return tokens.map(token => ({
		...token, // Keep all original fields
		chainId: token.chainId,
		address: token.address.toLowerCase(), // Normalize addresses
		name: token.name,
		symbol: token.symbol
	}));
}

function createMetricsStore() {
	const { subscribe, set } = writable<PlatformMetrics | null>(null);

	const clearCache = () => {
		try {
			// Get all cache keys
			const keys = Object.keys(localStorage).filter(key => 
				key.startsWith('tokenList_') || 
				key === 'providers' || 
				key === 'networks'
			);

			// Remove all cache entries
			keys.forEach(key => localStorage.removeItem(key));
			console.log('Cache cleared successfully');
		} catch (error) {
			console.error('Error clearing cache:', error);
		}
	};

	const clearOldestCache = () => {
		try {
			const keys = Object.keys(localStorage).filter(key => 
				key.startsWith('tokenList_') || 
				key === 'providers' || 
				key === 'networks'
			);

			if (keys.length === 0) return;

			// Sort by timestamp
			const entries = keys
				.map(key => {
					try {
						const item = localStorage.getItem(key);
						if (!item) return null;
						const parsed = JSON.parse(item);
						return { key, timestamp: parsed.timestamp };
					} catch {
						return null;
					}
				})
				.filter((entry): entry is { key: string; timestamp: number } => entry !== null)
				.sort((a, b) => a.timestamp - b.timestamp);

			// Remove oldest entries until we're under the size limit
			let currentSize = 0;
			for (const key of Object.keys(localStorage)) {
				const value = localStorage.getItem(key);
				if (value) {
					currentSize += value.length * 2; // Approximate size in bytes
				}
			}

			while (currentSize > MAX_CACHE_SIZE && entries.length > 0) {
				const oldest = entries.shift();
				if (oldest) {
					const value = localStorage.getItem(oldest.key);
					if (value) {
						currentSize -= value.length * 2;
						localStorage.removeItem(oldest.key);
					}
				}
			}
		} catch (error) {
			console.error('Error clearing cache:', error);
		}
	};

	const getFromCache = <T>(key: string): T | null => {
		try {
			const cached = localStorage.getItem(key);
			if (!cached) return null;
			const parsedCache: CacheEntry<T> = JSON.parse(cached);
			if (!isCacheValid(parsedCache)) return null;
			return parsedCache.data;
		} catch (error) {
			console.error(`Error reading from cache (${key}):`, error);
			return null;
		}
	};

	const setToCache = <T>(key: string, data: T, forceCompress = false): void => {
		try {
			let finalData = data;
			let compressed = false;

			// For token lists, try to compress if needed
			if (key.startsWith('tokenList_') && Array.isArray(data)) {
				if (forceCompress || data.length > MAX_TOKENS_PER_LIST) {
					finalData = compressTokenList(data as TokenInfo[]) as T;
					compressed = true;
				}
			}

			const cacheEntry: CacheEntry<T> = {
				timestamp: Date.now(),
				data: finalData,
				compressed
			};
			
			const serialized = JSON.stringify(cacheEntry);
			if (serialized.length > MAX_ENTRY_SIZE) {
				if (!compressed && key.startsWith('tokenList_')) {
					// Try again with compression
					setToCache(key, data, true);
					return;
				}
				console.warn(`Cache entry ${key} too large (${serialized.length} bytes), skipping cache`);
				return;
			}

			try {
				localStorage.setItem(key, serialized);
			} catch (error) {
				if (error instanceof Error && error.name === 'QuotaExceededError') {
					clearOldestCache();
					try {
						localStorage.setItem(key, serialized);
					} catch (retryError) {
						if (!compressed && key.startsWith('tokenList_')) {
							// Try one last time with compression
							setToCache(key, data, true);
						} else {
							console.error(`Failed to cache ${key} after cleanup:`, retryError);
						}
					}
				} else {
					console.error(`Error writing to cache (${key}):`, error);
				}
			}
		} catch (error) {
			console.error(`Error preparing cache entry (${key}):`, error);
		}
	};

	const fetchTokenList = async (provider: string) => {
		const cacheKey = `tokenList_${provider}`;
		const cachedData = getFromCache<TokenInfo[]>(cacheKey);
		
		if (cachedData) {
			return cachedData;
		}

		try {
			const response = await fetch(getApiUrl(`/list/${provider}`));
			if (!response.ok) {
				console.error(`Failed to fetch list ${provider}, status: ${response.status}`);
				return [];
			}
			const data = await response.json();
			const tokens = data.tokens || [];
			
			// Don't compress the tokens for metrics calculation
			if (tokens.length > 0) {
				console.log(`Fetched ${tokens.length} tokens from ${provider}`);
			}
			
			setToCache(cacheKey, tokens);
			return tokens;
		} catch (error) {
			console.error(`Failed to fetch ${provider} list:`, error);
			return [];
		}
	};

	async function fetchProviders() {
		const cacheKey = 'providers';
		const cachedData = getFromCache<Provider[]>(cacheKey);

		if (cachedData) {
			return cachedData;
		}

		try {
			const response = await fetch('https://gib.show/list');
			if (!response.ok) return [];
			const providers = await response.json();
			setToCache(cacheKey, providers);
			return providers as Provider[];
		} catch (error) {
			console.error('Failed to fetch providers:', error);
			return [];
		}
	}

	async function fetchNetworks() {
		const cacheKey = 'networks';
		const cachedData = getFromCache<string[]>(cacheKey);

		if (cachedData) {
			return cachedData;
		}

		try {
			const response = await fetch(getApiUrl('/networks'));
			if (!response.ok) return [];
			const networks = await response.json();
			setToCache(cacheKey, networks);
			return networks;
		} catch (error) {
			console.error('Failed to fetch networks:', error);
			return [];
		}
	}

	async function fetchMetrics(forceFresh = false) {
		try {
			// Check cache first unless forceFresh is true
			if (!forceFresh) {
				const cachedMetrics = getFromCache<PlatformMetrics>('metrics');
				if (cachedMetrics) {
					console.log('Using cached metrics');
					set(cachedMetrics);
					return;
				}
			} else {
				// Only clear cache if forceFresh is true
				console.log('Force refreshing metrics, clearing cache...');
				clearCache();
			}

			// Fetch available networks and providers
			const [networks, providers] = await Promise.all([
				fetchNetworks(),
				fetchProviders()
			]);

			// Get unique provider keys, prioritizing certain providers
			const priorityProviders = ['coingecko', 'uniswap-uniswap-default-list'];
			const uniqueProviders = [...new Set(providers
				.sort((a, b) => {
					const aIndex = priorityProviders.indexOf(a.providerKey);
					const bIndex = priorityProviders.indexOf(b.providerKey);
					if (aIndex !== -1 && bIndex === -1) return -1;
					if (aIndex === -1 && bIndex !== -1) return 1;
					if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
					return 0;
				})
				.map(p => p.providerKey)
			)];

			console.log('Fetching token lists from providers:', uniqueProviders);

			// Fetch all token lists in parallel
			const allTokenLists = await Promise.all(
				uniqueProviders.map(async (provider) => {
					const tokens = await fetchTokenList(provider);
					console.log(`Fetched ${tokens.length} tokens from ${provider}`);
					return tokens;
				})
			);

			// Create a map to store unique tokens per chain
			const tokensByChain: Record<string, Map<string, TokenInfo>> = {};

			// Process all tokens from all lists
			for (const tokenList of allTokenLists) {
				for (const token of tokenList) {
					if (!token.chainId || !token.address) continue; // Skip invalid tokens
					
					const chainId = token.chainId.toString();
					const address = token.address.toLowerCase(); // Normalize addresses
					
					// Initialize map for this chain if it doesn't exist
					if (!tokensByChain[chainId]) {
						tokensByChain[chainId] = new Map();
					}
					
					// Store the token - we want to count all unique tokens
					tokensByChain[chainId].set(address, token);
				}
			}

			// Count tokens by chain
			const byChain: Record<string, number> = {};
			for (const chainId of networks) {
				const count = tokensByChain[chainId]?.size || 0;
				byChain[chainId] = count;
				console.log(`Chain ${chainId}: ${count} tokens`);
			}

			// Calculate total
			const total = Object.values(byChain).reduce((sum, count) => sum + count, 0);
			console.log('Total tokens across all chains:', total);

			const metrics: PlatformMetrics = {
				tokenList: {
					total,
					byChain
				},
				networks: {
					supported: networks.map((chainId: string) => ({
						chainId: parseInt(chainId),
						name: `Chain ${chainId}`,
						isActive: chainId === '369'
					})),
					active: 'PulseChain'
				}
			};

			// Cache the computed metrics
			setToCache('metrics', metrics);
			set(metrics);

		} catch (error) {
			console.error('Failed to fetch metrics:', error);
			set({
				tokenList: {
					total: 0,
					byChain: {}
				},
				networks: {
					supported: [],
					active: 'PulseChain'
				}
			});
		}
	}

	return {
		subscribe,
		fetchMetrics,
		clearCache
	};
}

export const metrics = createMetricsStore();
