export interface TokenInfo {
	chainId: number;
	address: string;
	name: string;
	symbol: string;
	decimals: number;
}

export interface NetworkInfo {
	chainId: number;
	name: string;
	isActive: boolean;
}

export interface PlatformMetrics {
	tokenList: {
		total: number;
		byChain: Record<number, number>;
	};
	networks: {
		supported: NetworkInfo[];
		active: string;
	};
}
