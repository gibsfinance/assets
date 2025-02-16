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

interface TokenChunk {
	startIndex: number;
	tokens: TokenInfo[];
}

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MAX_CACHE_SIZE = 4.5 * 1024 * 1024; // 4.5MB
const MAX_ENTRY_SIZE = 500 * 1024; // 500KB for a single entry
const MAX_TOKENS_PER_LIST = 100000; // Increased to handle large token lists
const CHUNK_SIZE = 500; // Reduced chunk size
const MAX_CHUNKS_PER_LIST = 5; // Limit total chunks per list
const MINIMUM_TOKENS_FOR_CHUNKING = 1000; // Only chunk if more than 1000 tokens

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

function chunkTokenList(tokens: TokenInfo[]): TokenChunk[] {
	const chunks: TokenChunk[] = [];
	for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
		chunks.push({
			startIndex: i,
			tokens: tokens.slice(i, i + CHUNK_SIZE)
		});
	}
	return chunks;
}

// Add new helper function to filter and compress tokens
function filterAndCompressTokens(tokens: TokenInfo[]): TokenInfo[] {
	// Keep only essential fields and normalize addresses
	return tokens.map(token => ({
		chainId: token.chainId,
		address: token.address.toLowerCase(),
		symbol: token.symbol,
		name: token.name,
		decimals: token.decimals
	}));
}

function createMetricsStore() {
	const { subscribe, set } = writable<PlatformMetrics | null>(null);

	const clearCache = () => {
		try {
			const keys = Object.keys(localStorage);
			const cacheKeys = keys.filter(key => 
				key.startsWith('tokenList_') || 
				key === 'providers' || 
				key === 'networks'
			);
			
			cacheKeys.forEach(key => {
				localStorage.removeItem(key);
				// Also remove any associated chunks
				if (key.startsWith('tokenList_')) {
					keys.filter(k => k.startsWith(`${key}_chunk_`))
						.forEach(chunkKey => localStorage.removeItem(chunkKey));
					localStorage.removeItem(`${key}_meta`);
				}
			});
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
			// Check for chunked token list
			if (key.startsWith('tokenList_')) {
				const metaKey = `${key}_meta`;
				const meta = localStorage.getItem(metaKey);
				
				if (meta) {
					const { data: { chunks } } = JSON.parse(meta);
					const allTokens: TokenInfo[] = [];
					
					// Collect all available chunks
					for (let i = 0; i < chunks; i++) {
						try {
							const chunkKey = `${key}_chunk_${i}`;
							const chunkData = localStorage.getItem(chunkKey);
							if (!chunkData) continue;
							
							const chunk: CacheEntry<TokenChunk> = JSON.parse(chunkData);
							if (isCacheValid(chunk)) {
								allTokens.push(...chunk.data.tokens);
							}
						} catch (error) {
							console.warn(`Failed to read chunk ${i}`);
						}
					}
					
					if (allTokens.length > 0) {
						return allTokens as T;
					}
				}
			}

			// Regular cache handling
			const cached = localStorage.getItem(key);
			if (!cached) return null;
			
			const parsedCache: CacheEntry<T> = JSON.parse(cached);
			return isCacheValid(parsedCache) ? parsedCache.data : null;
		} catch (error) {
			console.warn(`Failed to read cache for ${key}`, error);
			return null;
		}
	};

	const setToCache = <T>(key: string, data: T, forceCompress = false): void => {
		try {
			// Special handling for token lists
			if (key.startsWith('tokenList_') && Array.isArray(data)) {
				const tokens = data as TokenInfo[];
				
				// Only chunk if we have a large number of tokens
				if (tokens.length > MINIMUM_TOKENS_FOR_CHUNKING) {
					// Compress tokens first
					const compressedTokens = filterAndCompressTokens(tokens);
					const chunks = chunkTokenList(compressedTokens);
					
					// Limit number of chunks to prevent excessive storage usage
					const limitedChunks = chunks.slice(0, MAX_CHUNKS_PER_LIST);
					
					let successfulChunks = 0;
					limitedChunks.forEach((chunk, index) => {
						const chunkKey = `${key}_chunk_${index}`;
						try {
							const chunkEntry: CacheEntry<TokenChunk> = {
								timestamp: Date.now(),
								data: {
									startIndex: chunk.startIndex,
									tokens: chunk.tokens
								}
							};
							
							const serialized = JSON.stringify(chunkEntry);
							if (serialized.length <= MAX_ENTRY_SIZE) {
								localStorage.setItem(chunkKey, serialized);
								successfulChunks++;
							}
						} catch (error) {
							// Individual chunk failed, continue with others
							console.warn(`Skipping chunk ${index} due to storage error`);
						}
					});

					// Only store metadata if we successfully stored some chunks
					if (successfulChunks > 0) {
						const metaEntry = {
							timestamp: Date.now(),
							data: {
								totalTokens: tokens.length,
								storedTokens: successfulChunks * CHUNK_SIZE,
								chunks: successfulChunks
							}
						};
						try {
							localStorage.setItem(`${key}_meta`, JSON.stringify(metaEntry));
						} catch (error) {
							console.warn('Failed to store chunk metadata');
						}
					}
					return;
				}
			}

			// Regular cache handling for non-token-list data or small token lists
			const cacheEntry: CacheEntry<T> = {
				timestamp: Date.now(),
				data: data
			};
			
			try {
				const serialized = JSON.stringify(cacheEntry);
				if (serialized.length <= MAX_ENTRY_SIZE) {
					localStorage.setItem(key, serialized);
				}
			} catch (error) {
				console.warn(`Failed to cache ${key}`, error);
			}
		} catch (error) {
			console.warn(`Error preparing cache entry for ${key}`, error);
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
				// Only log error if it's not a 404 (missing list is expected for some providers)
				if (response.status !== 404) {
					console.error(`Failed to fetch list ${provider}, status: ${response.status}`);
				}
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
			const response = await fetch(getApiUrl('/list'));
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
