import { useMemo } from 'react'

interface ErrorMessageProps {
  urlType?: 'token' | 'network'
  chainId?: string | number | null
  networkName?: string
  tokenAddress?: string
  generatedUrl?: string
  onSubmitIssue?: () => void
}

const GITHUB_REPO_URL = 'https://github.com/gibsfinance/assets'

export default function ErrorMessage({
  urlType = 'token',
  chainId = null,
  networkName = '',
  tokenAddress = '',
  generatedUrl = '',
  onSubmitIssue = () => {},
}: ErrorMessageProps) {
  const issueUrl = useMemo(() => {
    const params = new URLSearchParams({
      template: 'missing-asset.yml',
      title: `[Missing Asset]: ${urlType === 'token' ? `Token icon for ${tokenAddress}` : `Network icon for ${networkName}`}`,
      'asset-type': urlType === 'token' ? 'Token Icon' : 'Network Icon',
      'network-name': networkName,
      'chain-id': chainId?.toString() || '',
      'token-address': tokenAddress,
      'attempted-url': generatedUrl,
    })
    return `${GITHUB_REPO_URL}/issues/new?${params.toString()}`
  }, [urlType, chainId, networkName, tokenAddress, generatedUrl])

  return (
    <div className="elevated-card border-red-500/40 p-4">
      <div className="flex items-center gap-3">
        <i className="fas fa-exclamation-circle text-red-500"></i>
        <div className="flex-1">
          <p className="font-medium text-red-500">No icon found</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            There is no {urlType === 'token' ? 'token' : 'network'} icon available for this address
            yet. You can help by{' '}
            <a href={issueUrl} className="text-accent-500 hover:text-accent-400 underline underline-offset-2 transition-colors" onClick={onSubmitIssue}>
              submitting an issue
            </a>{' '}
            or contributing directly to the{' '}
            <a
              href={GITHUB_REPO_URL}
              className="text-accent-500 hover:text-accent-400 underline underline-offset-2 transition-colors"
              target="_blank"
              rel="noopener"
            >
              Gib Assets repository
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
