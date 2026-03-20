import { useState, useEffect, useMemo, Fragment } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { useSettings } from '../contexts/SettingsContext'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getNetworkName } from '../utils/network-name'
import { getApiUrl } from '../utils'
import type { NetworkInfo } from '../types'

interface NetworkSelectProps {
  selectedChainId: string | null
  onSelect: (chainId: string) => void
}

/**
 * @deprecated Legacy props interface — kept so Wizard.tsx continues to compile.
 * New code should use `NetworkSelectProps` (selectedChainId + onSelect(string)).
 */
interface LegacyNetworkSelectProps {
  isOpenToStart: boolean
  network: NetworkInfo | null
  onSelect: (network: NetworkInfo) => void
  onNetworkName: (getName: (id: string | number) => string) => void
}

type Props = NetworkSelectProps | LegacyNetworkSelectProps

function isLegacyProps(props: Props): props is LegacyNetworkSelectProps {
  return 'network' in props || 'onNetworkName' in props
}

export default function NetworkSelect(props: Props) {
  if (isLegacyProps(props)) {
    return <LegacyNetworkSelect {...props} />
  }
  return <ModernNetworkSelect {...props} />
}

/* -------------------------------------------------------------------------- */
/*  Modern implementation (new StudioBrowser path)                            */
/* -------------------------------------------------------------------------- */

function ModernNetworkSelect({ selectedChainId, onSelect }: NetworkSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { showTestnets, setShowTestnets } = useSettings()
  const { metrics } = useMetricsContext()

  const sortedNetworks = useMemo(() => {
    if (!metrics) return []
    return sortNetworks(metrics.networks.supported, showTestnets)
  }, [metrics, showTestnets])

  const selectedNetwork = useMemo(
    () => sortedNetworks.find((n) => n.chainId.toString() === selectedChainId) ?? null,
    [sortedNetworks, selectedChainId],
  )

  return (
    <div className="relative w-full">
      <div className="mb-2 flex items-center justify-end">
        <TestnetToggle showTestnets={showTestnets} setShowTestnets={setShowTestnets} />
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-between rounded-xl border border-border-dark bg-surface-1 px-4 py-2.5 text-left text-sm transition-colors hover:border-accent-500/40"
        onClick={() => setIsOpen(true)}
      >
        {selectedNetwork ? (
          <span className="flex items-center gap-2 truncate">
            <img
              src={getApiUrl(`/image/${selectedNetwork.chainId}`)}
              alt=""
              width={20}
              height={20}
              className="inline-block rounded-full"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            {getNetworkName(selectedNetwork.chainId)}{' '}
            <span className="text-white/40">(Chain ID: {selectedNetwork.chainId})</span>
          </span>
        ) : (
          <span className="text-white/40">Choose a network...</span>
        )}
        <i
          className={`fas fa-chevron-down flex-shrink-0 text-accent-500/60 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <NetworkDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        sortedNetworks={sortedNetworks}
        selectedChainId={selectedChainId}
        onPick={(network) => {
          setIsOpen(false)
          onSelect(network.chainId.toString())
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Legacy implementation (kept for Wizard.tsx backward-compat)               */
/* -------------------------------------------------------------------------- */

function LegacyNetworkSelect({
  isOpenToStart,
  network: selectedNetwork,
  onSelect,
  onNetworkName,
}: LegacyNetworkSelectProps) {
  const [isOpen, setIsOpen] = useState(isOpenToStart)
  const { showTestnets, setShowTestnets } = useSettings()
  const { metrics } = useMetricsContext()

  // Expose getNetworkName to parent
  useEffect(() => {
    onNetworkName(getNetworkName)
  }, [onNetworkName])

  // On mount: read localStorage.selectedChainId, select it, clear the key
  useEffect(() => {
    const storedChainId = localStorage.getItem('selectedChainId')
    if (!storedChainId || !metrics) return
    const network = metrics.networks.supported.find(
      (n) => n.chainId.toString() === storedChainId,
    )
    if (network) onSelect(network)
    localStorage.removeItem('selectedChainId')
  }, [metrics, onSelect])

  const sortedNetworks = useMemo(() => {
    if (!metrics) return []
    return sortNetworks(metrics.networks.supported, showTestnets)
  }, [metrics, showTestnets])

  return (
    <div className="relative w-full">
      <div className="mb-2 flex items-center justify-end">
        <TestnetToggle showTestnets={showTestnets} setShowTestnets={setShowTestnets} />
      </div>

      <button
        type="button"
        className="btn preset-tonal w-full justify-between px-3 py-2 text-left text-sm leading-6 border border-gray-500 hover:border-gray-400 items-center rounded-lg select-network"
        onClick={() => setIsOpen(true)}
      >
        {selectedNetwork ? (
          <span className="truncate">
            {getNetworkName(selectedNetwork.chainId)} (Chain ID: {selectedNetwork.chainId})
          </span>
        ) : (
          <span className="text-gray-500">Choose a network...</span>
        )}
        <i
          className={`fas fa-chevron-down !m-0 flex-shrink-0 transition-transform flex items-center ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <NetworkDialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        sortedNetworks={sortedNetworks}
        selectedChainId={selectedNetwork?.chainId.toString() ?? null}
        onPick={(network) => {
          setIsOpen(false)
          onSelect(network)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

function sortNetworks(networks: NetworkInfo[], showTestnets: boolean): NetworkInfo[] {
  const priorityChains = ['1', '369']

  let filtered = networks
  if (!showTestnets) {
    filtered = networks.filter(
      (network) => !getNetworkName(network.chainId).toLowerCase().includes('testnet'),
    )
  }

  return [...filtered].sort((a, b) => {
    const aId = a.chainId.toString()
    const bId = b.chainId.toString()
    const aIdx = priorityChains.indexOf(aId)
    const bIdx = priorityChains.indexOf(bId)

    if (aIdx !== -1 && bIdx === -1) return -1
    if (aIdx === -1 && bIdx !== -1) return 1
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx

    return getNetworkName(a.chainId).localeCompare(getNetworkName(b.chainId))
  })
}

function TestnetToggle({
  showTestnets,
  setShowTestnets,
}: {
  showTestnets: boolean
  setShowTestnets: (v: boolean) => void
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3">
      <div className="relative flex">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={showTestnets}
          onChange={(e) => setShowTestnets(e.target.checked)}
        />
        <div className="h-6 w-11 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent-500/20" />
        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/60 transition-all peer-checked:translate-x-5 peer-checked:bg-accent-500" />
      </div>
      <span className="text-sm font-medium text-white/50 transition-colors group-hover:text-accent-500">
        Show&nbsp;Testnets
      </span>
    </label>
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
          leaveTo="opacity-0"
        >
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
          leaveTo="-translate-x-full"
        >
          <DialogPanel className="fixed inset-y-0 left-0 w-[480px] overflow-y-auto border-r border-border-dark bg-surface-base shadow-elevated">
            <div className="sticky top-0 z-10 border-b border-border-dark bg-surface-base/90 px-4 py-3 backdrop-blur-sm">
              <h2 className="font-heading text-lg font-semibold text-white">
                Select Network
              </h2>
            </div>

            <div className="flex flex-col">
              {sortedNetworks.map((network) => (
                <button
                  key={network.chainId}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-accent-500/10 ${
                    selectedChainId === network.chainId.toString()
                      ? 'bg-accent-500/5 border-l-2 border-accent-500'
                      : 'border-l-2 border-transparent'
                  }`}
                  onClick={() => onPick(network)}
                >
                  <span className="mr-2 flex items-center gap-3 truncate">
                    <img
                      src={getApiUrl(`/image/${network.chainId}`)}
                      alt=""
                      width={24}
                      height={24}
                      className="inline-block rounded-full"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                    <span className="text-white/90">{getNetworkName(network.chainId)}</span>
                  </span>
                  <span className="flex-shrink-0 whitespace-nowrap text-sm text-white/30">
                    Chain {network.chainId}
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
