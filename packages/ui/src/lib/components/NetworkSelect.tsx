import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSettings } from '../contexts/SettingsContext'
import { useMetrics } from '../hooks/useMetrics'
import { getApiUrl } from '../utils'
import { toChainIdentifier } from '../utils/chain-identifier'
import { searchNetworks } from '../utils/network-metrics'
import Image from './Image'
import type { NetworkInfo } from '../types'

interface NetworkSelectProps {
  selectedChainId: string | null
  onSelect: (chainId: string | null) => void
}

export default function NetworkSelect({ selectedChainId, onSelect }: NetworkSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { showTestnets } = useSettings()
  const { metrics } = useMetrics()

  const sortedNetworks = useMemo(() => {
    if (!metrics) return []
    return sortNetworks(metrics.networks.supported, showTestnets)
  }, [metrics, showTestnets])

  // Normalize the incoming selection to its canonical identifier so a bare
  // numeric value from an old bookmark or stored preference (e.g. "1") still
  // matches the network whose identifier is "eip155-1".
  const selectedIdentifier = selectedChainId ? toChainIdentifier(selectedChainId) : null

  const selectedNetwork = useMemo(
    () => sortedNetworks.find((n) => n.chainIdentifier === selectedIdentifier) ?? null,
    [sortedNetworks, selectedIdentifier],
  )

  return (
    <div className="relative w-full">
      <button
        type="button"
        className="flex w-full items-center justify-between border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-1 px-4 py-2.5 text-left text-sm transition-colors hover:border-accent-500/40"
        onClick={() => setIsOpen(true)}>
        {selectedNetwork ? (
          <span className="flex items-center gap-2 truncate">
            <Image
              src={getApiUrl(`/image/${selectedNetwork.chainIdentifier}`)}
              size={20}
              skeleton
              shape="circle"
              className="inline-block rounded-full"
            />
            {selectedNetwork.name}{' '}
            <span className="text-gray-400 dark:text-white/40">({selectedNetwork.chainIdentifier})</span>
          </span>
        ) : (
          <span className="text-gray-400 dark:text-white/40">Choose a network...</span>
        )}
        <span className="flex flex-shrink-0 items-center gap-1">
          {selectedNetwork && (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-3 dark:hover:text-white/70"
              onClick={(e) => {
                e.stopPropagation()
                onSelect(null)
              }}
              aria-label="Clear network selection">
              <i className="fas fa-times text-[10px]" />
            </button>
          )}
          <i className={`fas fa-chevron-down text-accent-500/60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      <NetworkDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        sortedNetworks={sortedNetworks}
        selectedChainId={selectedIdentifier}
        onPick={(network) => {
          setIsOpen(false)
          onSelect(network.chainIdentifier)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Order the drawer: Ethereum, then PulseChain, then everything else by name.
 *
 * Reads the `name` and `isTestnet` useMetrics already resolved rather than re-deriving
 * them. Beyond being the single source, that fixes what re-deriving got wrong: it
 * passed the bare `chainId`, so every non-Ethereum-Virtual-Machine chain looked up its
 * coin type as if it were an Ethereum chain id — Bitcoin (bip122-0) resolved to
 * "Chain 0" and sorted under C, and the testnet filter matched that same wrong string.
 */
function sortNetworks(networks: NetworkInfo[], showTestnets: boolean): NetworkInfo[] {
  const priorityChains = ['1', '369']

  let filtered = networks
  if (!showTestnets) {
    filtered = networks.filter((network) => !network.isTestnet)
  }

  return [...filtered].sort((a, b) => {
    const aId = a.chainId.toString()
    const bId = b.chainId.toString()
    const aIdx = priorityChains.indexOf(aId)
    const bIdx = priorityChains.indexOf(bId)

    if (aIdx !== -1 && bIdx === -1) return -1
    if (aIdx === -1 && bIdx !== -1) return 1
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx

    return a.name.localeCompare(b.name)
  })
}

/** Height of one drawer row in pixels; the virtualizer's size estimate. */
const NETWORK_ROW_HEIGHT = 45

/**
 * The scrolling network list.
 *
 * Virtualized because the drawer carries every supported network — over 1,900
 * of them, some 7,000 Document Object Model nodes if all were mounted, each
 * with its own image element and IntersectionObserver. The token list beside it
 * has always been virtualized; this one was not.
 */
function VirtualNetworkList({
  networks,
  selectedChainId,
  onPick,
}: {
  networks: NetworkInfo[]
  selectedChainId: string | null
  onPick: (network: NetworkInfo) => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: networks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => NETWORK_ROW_HEIGHT,
    overscan: 8,
  })

  if (networks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-10 text-sm text-gray-400 dark:text-white/30">
        No networks match that search
      </div>
    )
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto" style={{ contain: 'layout style' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const network = networks[virtualRow.index]
          return (
            <button
              key={network.chainIdentifier}
              className={`absolute left-0 top-0 flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-accent-500/10 ${
                selectedChainId === network.chainIdentifier
                  ? 'bg-accent-500/5 border-l-2 border-accent-500'
                  : 'border-l-2 border-transparent'
              }`}
              style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
              onClick={() => onPick(network)}>
              <span className="mr-2 flex items-center gap-3 truncate">
                <Image
                  src={getApiUrl(`/image/${network.chainIdentifier}`)}
                  size={24}
                  skeleton
                  lazy
                  shape="circle"
                  className="inline-block rounded-full"
                />
                <span className="truncate text-gray-900 dark:text-white/90">{network.name}</span>
              </span>
              <span className="flex-shrink-0 whitespace-nowrap text-sm text-gray-400 dark:text-white/30">
                {network.isEvm ? `Chain ${network.chainId}` : network.chainIdentifier}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function NetworkDialog({
  isOpen,
  onClose,
  sortedNetworks,
  selectedChainId,
  onPick,
}: {
  isOpen: boolean
  onClose: () => void
  sortedNetworks: NetworkInfo[]
  selectedChainId: string | null
  onPick: (network: NetworkInfo) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchNetworks(sortedNetworks, query), [sortedNetworks, query])

  // Start every visit from the full list rather than whatever was typed last.
  useEffect(() => {
    if (!isOpen) setQuery('')
  }, [isOpen])

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        {/* Backdrop */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        {/* Sliding panel */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="-translate-x-full"
          enterTo="translate-x-0"
          leave="ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="-translate-x-full">
          <DialogPanel className="fixed inset-y-0 left-0 flex w-[480px] flex-col overflow-hidden border-r border-border-light dark:border-border-dark bg-white dark:bg-surface-base shadow-elevated">
            <div className="flex-shrink-0 border-b border-border-light dark:border-border-dark bg-white/90 dark:bg-surface-base/90 px-4 py-3 backdrop-blur-sm">
              <h2 className="font-heading text-lg font-semibold text-gray-900 dark:text-white">Select Network</h2>
              <div className="relative mt-2">
                <i className="fas fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 dark:text-white/30" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${sortedNetworks.length.toLocaleString()} networks...`}
                  aria-label="Search networks"
                  className="w-full rounded-lg border border-border-light dark:border-border-dark bg-gray-50 dark:bg-surface-2 py-2 pl-8 pr-3 text-sm text-gray-900 dark:text-white/90 placeholder:text-gray-400 dark:placeholder:text-white/30 focus:border-accent-500/40 focus:outline-none"
                />
              </div>
            </div>

            {/*
              Remount the list whenever it becomes a different list — a new visit,
              or a new query. The scroll offset is owned jointly by the container
              and the virtualizer's own state, and closing the drawer does not
              unmount either: scroll 8,000 pixels into the 52,000-pixel list,
              close, reopen, and the drawer came back at Camino C-Chain under a
              freshly cleared search box claiming to list all 1,900 networks.
              Typing was worse — the ranked list rebuilt beneath a stale offset, so
              the best match for what was being typed sat 8,000 pixels above the
              viewport.

              Resetting from an effect cannot fix this: on open the effect runs
              before this panel's DOM exists, so it moves nothing, and moving the
              container alone desynchronizes the pair — the container reads 0 while
              rows stay laid out at translateY(7605px) and the drawer paints
              completely empty. Measured in the browser: zero rows intersecting the
              viewport. A remount gives a fresh container and a virtualizer whose
              offset starts at zero, so the two cannot disagree.
            */}
            <VirtualNetworkList
              key={isOpen ? `open:${query}` : 'closed'}
              networks={matches}
              selectedChainId={selectedChainId}
              onPick={onPick}
            />
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </Transition>
  )
}
