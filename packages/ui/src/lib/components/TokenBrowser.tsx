import { useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import Image from './Image'
import PaginationControls from './PaginationControls'
import type { Token } from '../types'
import { getApiUrl } from '../utils'

interface TokenBrowserProps {
  networkName: string
  filteredTokens?: Token[]
  isCircularCrop?: boolean
  currentPage: number
  tokensPerPage: number
  onSelectToken: (token: Token) => void
  onPerPageUpdate: (perPage: number) => void
  onPageChange: (pageNumber: number) => void
  children?: ReactNode
}

export default function TokenBrowser({
  networkName,
  filteredTokens = [],
  isCircularCrop = false,
  currentPage = 1,
  tokensPerPage = 25,
  onSelectToken,
  onPerPageUpdate,
  onPageChange,
  children,
}: TokenBrowserProps) {
  // Track icons that failed to load so we can re-render with fallback
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())

  const paginatedTokens = filteredTokens.slice(
    (currentPage - 1) * tokensPerPage,
    currentPage * tokensPerPage,
  )

  function handleIconError(token: Token) {
    setFailedIcons((prev) => {
      const next = new Set(prev)
      next.add(`${token.chainId}-${token.address}`)
      return next
    })
  }

  return (
    <div className="card variant-ghost flex flex-col gap-2">
      {/* Search and filter slot */}
      {children}

      {filteredTokens.length === 0 ? (
        <div className="p-4 text-center text-gray-500">Loading tokens...</div>
      ) : (
        <>
          {/* Token Table with responsive design */}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Symbol</th>
                  <th>Network</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:hover:preset-tonal-primary">
                {paginatedTokens.map((token) => {
                  const iconKey = `${token.chainId}-${token.address}`
                  const hasIcon = token.hasIcon && !failedIcons.has(iconKey)

                  return (
                    <tr
                      key={iconKey}
                      className="cursor-pointer transition-colors hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20"
                      onClick={() => onSelectToken(token)}
                    >
                      <td className="p-1">
                        <div className="flex items-center gap-2">
                          <div
                            className={`relative flex h-10 min-h-[40px] w-10 min-w-[40px] items-center justify-center ${isCircularCrop ? 'rounded-full' : ''}`}
                          >
                            {hasIcon ? (
                              <Image
                                src={getApiUrl(
                                  `/image/${token.chainId}/${token.address}`,
                                )}
                                alt={token.symbol}
                                className={`user-drag-none object-contain ${isCircularCrop ? 'rounded-full' : ''}`}
                                size={32}
                                onError={() => handleIconError(token)}
                              />
                            ) : (
                              <Icon icon="nrk:404" className="h-8 w-8 text-surface-50" />
                            )}
                          </div>
                          <div className="flex flex-col" title={token.sourceList}>
                            <span className="font-medium whitespace-pre overflow-hidden text-ellipsis">
                              {token.name}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td title={token.symbol} className="px-1">
                        <span>{token.symbol}</span>
                      </td>
                      <td title={networkName} className="px-1">
                        <span className="text-sm">{networkName}</span>
                      </td>
                      <td title={token.address} className="px-1">
                        <code className="text-xs">{token.address}</code>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* Horizontal scroll indicator for small screens */}
            <div className="horizontal-scroll-hint">
              <span className="text-xs text-surface-500 md:hidden">
                &larr; Swipe horizontally to see more details &rarr;
              </span>
            </div>
          </div>

          {/* Pagination */}
          <div className="py-2 px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-surface-600 dark:text-surface-300">
                  Show
                </span>
                <select
                  className="select !h-7 !py-0 text-sm"
                  value={tokensPerPage}
                  onChange={(e) => onPerPageUpdate(Number(e.target.value))}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
                <span className="text-sm text-surface-600 dark:text-surface-300">
                  tokens
                </span>
              </div>
              <PaginationControls
                currentPage={currentPage}
                totalItems={filteredTokens.length}
                tokensPerPage={tokensPerPage}
                onPageChange={onPageChange}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
