import { useState, useMemo, Fragment } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { useSettings } from '../contexts/SettingsContext'
import { useMetrics } from '../hooks/useMetrics'
import { getApiUrl } from '../utils'
import { isTestnetName } from '../utils/is-testnet'
import { toChainIdentifier } from '../utils/chain-identifier'
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
 * Reads the `name` useMetrics already resolved rather than re-deriving one. Beyond
 * being the single source, that fixes what re-deriving got wrong: it passed the bare
 * `chainId`, so every non-Ethereum-Virtual-Machine chain looked up its coin type as
 * if it were an Ethereum chain id — Bitcoin (bip122-0) resolved to "Chain 0" and
 * sorted under C, and the testnet filter matched against that same wrong string.
 */
function sortNetworks(networks: NetworkInfo[], showTestnets: boolean): NetworkInfo[] {
  const priorityChains = ['1', '369']

  let filtered = networks
  if (!showTestnets) {
    filtered = networks.filter((network) => !isTestnetName(network.name))
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
          <DialogPanel className="fixed inset-y-0 left-0 w-[480px] overflow-y-auto border-r border-border-light dark:border-border-dark bg-white dark:bg-surface-base shadow-elevated">
            <div className="sticky top-0 z-10 border-b border-border-light dark:border-border-dark bg-white/90 dark:bg-surface-base/90 px-4 py-3 backdrop-blur-sm">
              <h2 className="font-heading text-lg font-semibold text-gray-900 dark:text-white">Select Network</h2>
            </div>

            <div className="flex flex-col">
              {sortedNetworks.map((network) => (
                <button
                  key={network.chainIdentifier}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-accent-500/10 ${
                    selectedChainId === network.chainIdentifier
                      ? 'bg-accent-500/5 border-l-2 border-accent-500'
                      : 'border-l-2 border-transparent'
                  }`}
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
                    <span className="text-gray-900 dark:text-white/90">{network.name}</span>
                  </span>
                  <span className="flex-shrink-0 whitespace-nowrap text-sm text-gray-400 dark:text-white/30">
                    {network.isEvm ? `Chain ${network.chainId}` : network.chainIdentifier}
                  </span>
                </button>
              ))}
            </div>
          </DialogPanel>
        </TransitionChild>
      </Dialog>
    </Transition>
  )
}
