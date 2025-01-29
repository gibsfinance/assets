export const prerender = true;
export const ssr = false;
export const trailingSlash = 'never';

// Handle base path for IPFS
if (typeof window !== 'undefined') {
	const updateBasePath = () => {
		const basePath = (window as any).__ipfsPath || '';
		if (basePath && !window.location.pathname.startsWith(basePath)) {
			const newPath = basePath + window.location.pathname;
			window.history.replaceState(null, '', newPath);
		}
	};

	// Handle hash-based navigation
	const updateHash = () => {
		const path = window.location.pathname + window.location.search;
		if (path !== '/' && !window.location.hash) {
			window.history.replaceState(null, '', '#' + path);
		}
	};

	window.addEventListener('popstate', () => {
		updateBasePath();
		updateHash();
	});

	updateBasePath();
	updateHash();
}
