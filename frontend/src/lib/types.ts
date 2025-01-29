export interface TokenInfo {
	chainId: number;
	address: string;
	name: string;
	symbol: string;
	decimals: number;
}

export type ApiType = 'token' | 'network' | 'list';

export type PositionType = 'back' | 'middle' | 'front';

export type Hex = `0x${string}`;

export type FloatingToken = {
    type?: ApiType;
    chainId?: number;
    address?: Hex;
    size: number;
    speed: number;
    delay: number;
    direction: number;
    layer: PositionType;
    startPos: number;
}

export interface NetworkInfo {
	chainId: number;
	name: string;
	isActive: boolean;
}

export interface PlatformMetrics {
<<<<<<< HEAD
	tokenList: {
		total: number;
		byChain: Record<number, number>;
	};
	networks: {
		supported: NetworkInfo[];
		active: string;
	};
=======
    tokenList: {
        total: number;
        byChain: Record<number, number>;
    };
    networks: {
        supported: NetworkInfo[];
        active: string;
    };
>>>>>>> 2f88e560 (Update frontend configuration and improve code structure)
}
