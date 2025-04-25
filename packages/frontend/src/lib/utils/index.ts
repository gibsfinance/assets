import { get, writable } from 'svelte/store'

export const apiBase = writable<string | null>(null)

export async function initializeApiBase(): Promise<string> {
  const currentBase = get(apiBase)
  if (currentBase) return currentBase

  // These values are defined in vite.config.ts
  const baseUrl = process.env.PUBLIC_BASE_URL as string

  console.log(`🌐 API: Using server at ${baseUrl}`)
  apiBase.set(baseUrl)
  return baseUrl
}

export function getApiUrl(path: string): string {
  const base = get(apiBase)
  if (!base) {
    return `https://gib.show${path}`
  }
  return `${base}${path}`
}

export const GET = async (params: Record<string, string>) => {
  const chainId = params.chainId
  try {
    const apiUrl = getApiUrl(`/list/default${chainId ? `?chainId=${chainId}` : ''}`)
    console.log('Fetching token list from:', apiUrl)

    const response = await fetch(apiUrl)
    if (!response.ok) {
      console.error('API response not OK:', response.status, response.statusText)
      throw new Error(`API request failed: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('API error:', error)
    return {
      error: 'Failed to fetch token list',
      details: (error as Error).message,
    }
  }
}
