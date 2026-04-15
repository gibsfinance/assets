import { root } from '../config'

let apiBase: string | null = null

export function initializeApiBase(): string {
  if (apiBase) return apiBase
  console.log(`🌐 API: Using server at ${root}`)
  apiBase = root
  return root
}

export function getApiUrl(path: string): string {
  const base = apiBase ?? root
  return `${base}${path}`
}

export async function GET(params: Record<string, string>) {
  const chainId = params.chainId
  try {
    const apiUrl = getApiUrl(`/list/default${chainId ? `?chainId=${chainId}` : ''}`)
    const response = await fetch(apiUrl)
    if (!response.ok) throw new Error(`API request failed: ${response.status}`)
    return await response.json()
  } catch (error) {
    return { error: 'Failed to fetch token list', details: (error as Error).message }
  }
}
