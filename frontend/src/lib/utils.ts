export function getApiUrl(path: string = ''): string {
    // Always use gib.show for API and image requests
    return `https://gib.show${path}`;
}

const API_BASE = 'https://gib.show';

export const GET = async (params: Record<string, string>) => {
    const chainId = params.chainId;
    try {
        const apiUrl = `${API_BASE}/list/default${chainId ? `?chainId=${chainId}` : ''}`;
        console.log('Fetching token list from:', apiUrl);

        const response = await fetch(apiUrl);
        if (!response.ok) {
            console.error('API response not OK:', response.status, response.statusText);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API error:', error);
        return {
            error: 'Failed to fetch token list',
            details: (error as Error).message
        };
    }
};

