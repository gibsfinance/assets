export function getApiUrl(path: string): string {
	// Always use gib.show for API and image requests
	return `https://gib.show${path}`;
}
