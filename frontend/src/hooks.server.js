/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	// Force relative paths for all routes
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => {
			return html
				.replace(/href="\//g, 'href="./')
				.replace(/src="\//g, 'src="./')
				.replace(/import("\/)/, 'import("./');
		}
	});
	return response;
}
