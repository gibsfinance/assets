import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const API_BASE = 'https://gib.show';

export const GET: RequestHandler = async ({ url }) => {
    const chainId = url.searchParams.get('chainId');
    try {
        const apiUrl = `${API_BASE}/list/default${chainId ? `?chainId=${chainId}` : ''}`;
        console.log('Fetching token list from:', apiUrl);
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
            console.error('API response not OK:', response.status, response.statusText);
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        return json(data);
    } catch (error) {
        console.error('API error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to fetch token list',
            details: error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
}; 