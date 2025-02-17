import { get, writable } from 'svelte/store'

export const apiBase = writable<string | null>(null)

async function checkLocalServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(process.env.VITE_API_LOCAL + '/health')
    if (!response.ok) return false
    const data = await response.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

export async function initializeApiBase(): Promise<string> {
  const currentBase = get(apiBase)
  if (currentBase) return currentBase

  const isLocalAvailable = await checkLocalServerAvailable()
  // These values are defined in vite.config.ts
  const baseUrl = isLocalAvailable ? (process.env.VITE_API_LOCAL as string) : (process.env.VITE_API_BASE as string)

  console.log(`🌐 API: Using ${isLocalAvailable ? 'local server' : 'production server'} at ${baseUrl}`)
  apiBase.set(baseUrl)
  return baseUrl
}

export function getApiUrl(path: string): string {
  const base = get(apiBase)
  if (!base) {
    return `${process.env.VITE_API_BASE}${path}` // Fallback to production
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
