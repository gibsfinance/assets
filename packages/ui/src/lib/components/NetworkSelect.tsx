import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { useSettings } from '../contexts/SettingsContext'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getNetworkName } from '../utils/network-name'
import { getApiUrl } from '../utils'
import type { NetworkInfo } from '../types'

interface NetworkSelectProps {
  isOpenToStart: boolean
  network: NetworkInfo | null
  onSelect: (network: NetworkInfo) => void
  onNetworkName: (getName: (id: string | number) => string) => void
}

export default function NetworkSelect({
  isOpenToStart,
  network: selectedNetwork,
  onSelect,
  onNetworkName,
}: NetworkSelectProps) {
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
    if (network) {
      onSelect(network)
    }
    localStorage.removeItem('selectedChainId')
  }, [metrics, onSelect])

  const sortNetworks = useCallback(
    (networks: NetworkInfo[]): NetworkInfo[] => {
      const priorityChains = ['1', '369']

      let filteredNetworks = networks
      if (!showTestnets) {
        filteredNetworks = networks.filter(
          (network) =>
            !getNetworkName(network.chainId).toLowerCase().includes('testnet'),
        )
      }

      return [...filteredNetworks].sort((a, b) => {
        const aChainId = a.chainId.toString()
        const bChainId = b.chainId.toString()

        const aIndex = priorityChains.indexOf(aChainId)
        const bIndex = priorityChains.indexOf(bChainId)

        if (aIndex !== -1 && bIndex === -1) return -1
        if (aIndex === -1 && bIndex !== -1) return 1
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex

        return getNetworkName(a.chainId).localeCompare(getNetworkName(b.chainId))
      })
    },
    [showTestnets],
  )

  const sortedNetworks = useMemo(() => {
    if (!metrics) return []
    return sortNetworks(metrics.networks.supported)
  }, [metrics, sortNetworks])

  return (
    <div className="relative w-full">
      <div className="mb-2 flex items-center justify-end">
        <label className="group flex cursor-pointer items-center gap-3 flex-row">
          <div className="relative flex">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={showTestnets}
              onChange={(e) => setShowTestnets(e.target.checked)}
            />
            <div className="h-6 w-11 rounded-full bg-surface-300 dark:bg-surface-600 transition-colors peer-checked:bg-secondary-600/20"></div>
            <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-surface-100 transition-all peer-checked:translate-x-5 peer-checked:bg-secondary-600"></div>
          </div>
          <span className="text-sm font-medium text-surface-600 transition-colors group-hover:text-secondary-600 dark:text-surface-300">
            Show&nbsp;Testnets
          </span>
        </label>
      </div>

      {/* Trigger button */}
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
        ></i>
      </button>

      {/* Slide-from-left dialog */}
      <Transition show={isOpen} as={Fragment}>
        <Dialog onClose={() => setIsOpen(false)} className="relative z-50">
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
            <div className="fixed inset-0 bg-black/30" />
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
            <DialogPanel className="fixed inset-y-0 left-0 w-[480px] bg-surface-100-900 space-y-4 shadow-xl overflow-y-auto">
              <article>
                {sortedNetworks.map((network) => (
                  <button
                    key={network.chainId}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-secondary-600 dark:hover:bg-secondary-600 ${
                      selectedNetwork?.chainId === network.chainId ? 'selected' : ''
                    }`}
                    onClick={() => {
                      setIsOpen(false)
                      onSelect(network)
                    }}
                  >
                    <span className="mr-2 truncate flex items-center gap-2">
                      <img
                        src={getApiUrl(`/image/${network.chainId}`)}
                        alt=""
                        width={20}
                        height={20}
                        className="inline-block rounded-full"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                      {getNetworkName(network.chainId)}
                    </span>
                    <span className="flex-shrink-0 whitespace-nowrap text-surface-500">
                      (Chain ID: {network.chainId})
                    </span>
                  </button>
                ))}
              </article>
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </div>
  )
}
