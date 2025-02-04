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

export const FALLBACK_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTggMTRzMS41IDIgNCAyIDQtMiA0LTIiLz48bGluZSB4MT0iOSIgeTE9IjkiIHgyPSI5LjAxIiB5Mj0iOSIvPjxsaW5lIHgxPSIxNSIgeTE9IjkiIHgyPSIxNS4wMSIgeTI9IjkiLz48L3N2Zz4='

