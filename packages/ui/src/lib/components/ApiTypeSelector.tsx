import type { ApiType, NetworkInfo } from '../types'

interface ApiTypeSelectorProps {
  urlType: ApiType
  network: NetworkInfo | null
  onSelect: (type: ApiType) => void
  onReset: () => void
  onLoadTokens: () => void
  onGenerate: () => void
}

export default function ApiTypeSelector({
  urlType,
  network,
  onSelect,
  onReset,
  onLoadTokens,
  onGenerate,
}: ApiTypeSelectorProps) {
  const selectType = (type: ApiType) => {
    if (type === urlType) return

    onSelect(type)
    onReset()

    if (type === 'token' && network) {
      onLoadTokens()
    } else if (type === 'network' && network) {
      onGenerate()
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <button
          type="button"
          className={`btn ${urlType === 'token' ? 'variant-filled-primary' : 'variant-ghost'}`}
          onClick={() => selectType('token')}
        >
          <i className="fas fa-coins mr-2"></i>
          Token Icon
        </button>
        <button
          type="button"
          className={`btn ${urlType === 'network' ? 'variant-filled-primary' : 'variant-ghost'}`}
          onClick={() => selectType('network')}
        >
          <i className="fas fa-network-wired mr-2"></i>
          Network Icon
        </button>
      </div>
    </div>
  )
}
