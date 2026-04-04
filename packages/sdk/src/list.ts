/** Build URL for a specific token list */
export function getTokenListUrl(
  baseUrl: string,
  provider: string,
  key: string,
  chainId?: number,
): string {
  const base = `${baseUrl}/list/${provider}/${key}`
  return chainId ? `${base}?chainId=${chainId}` : base
}

/** Build URL for the networks endpoint */
export function getNetworksUrl(baseUrl: string): string {
  return `${baseUrl}/networks`
}

/** Build URL for the list index */
export function getListIndexUrl(baseUrl: string): string {
  return `${baseUrl}/list`
}
