export async function handleError({ error, event }) {
	// Handle client-side errors gracefully
	console.error('Client error:', error);
	return {
		message: 'An error occurred',
		code: 'ERROR'
	};
}

export function handleFetch({ request, fetch }) {
	// Ensure absolute URLs for API calls
	if (!request.url.startsWith('http')) {
		const base = window.location.hostname === 'localhost' ? 'https://gib.show' : '';
		request = new Request(base + request.url, request);
	}
	return fetch(request);
}
