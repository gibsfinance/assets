import type { HandleClientError } from '@sveltejs/kit'

// Handle client-side navigation
export const handleError: HandleClientError = ({ error, event }) => {
  const errorId = crypto.randomUUID()
  console.error(error)
  return {
    message: 'An unexpected error occurred.',
    errorId,
  }
}

// Convert paths to hash-based routes for IPFS compatibility
if (typeof window !== 'undefined') {
  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  function convertToHashRoute(url: string | URL | null | undefined): string | URL | null {
    if (!url) return null
    const urlStr = url.toString()

    // Don't modify asset URLs or IPFS paths
    if (
      urlStr.includes('/_app/') ||
      urlStr.includes('/favicon.') ||
      urlStr.startsWith('http') ||
      urlStr.includes('/ipfs/') ||
      urlStr.includes('/ipns/')
    ) {
      return url
    }

    // Convert path to hash route
    const path = urlStr.startsWith('/') ? urlStr : '/' + urlStr
    // Ensure we don't double-hash
    return path.startsWith('#') ? path : '#' + path
  }

  // Force hash-based routing for initial page load
  if (
    window.location.pathname !== '/' &&
    !window.location.pathname.includes('/ipfs/') &&
    !window.location.pathname.includes('/ipns/') &&
    !window.location.pathname.includes('/_app/')
  ) {
    const newPath = '#' + window.location.pathname + window.location.search + window.location.hash
    window.location.replace(window.location.origin + '/' + newPath)
  }

  history.pushState = function (data: any, unused: string, url?: string | URL | null) {
    const convertedUrl = convertToHashRoute(url)
    return originalPushState.call(this, data, unused, convertedUrl)
  }

  history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
    const convertedUrl = convertToHashRoute(url)
    return originalReplaceState.call(this, data, unused, convertedUrl)
  }
}
