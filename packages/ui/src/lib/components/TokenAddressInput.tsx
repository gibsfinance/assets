import { useState, useEffect } from 'react'

interface TokenAddressInputProps {
  address: string
  onInput: (addr: string) => void
  onBack: () => void
}

export default function TokenAddressInput({
  address,
  onInput,
  onBack,
}: TokenAddressInputProps) {
  const [tokenAddress, setTokenAddress] = useState('')

  useEffect(() => {
    setTokenAddress(address)
  }, [address])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value.trim()
    setTokenAddress(value)
    onInput(value)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="token-address" className="text-sm font-medium">
          Token Address
        </label>
        <button className="variant-filled-primary btn btn-sm" onClick={onBack}>
          <i className="fas fa-arrow-left mr-2"></i>
          Back to Token Browser
        </button>
      </div>
      <input
        id="token-address"
        type="text"
        className="input"
        placeholder="0x..."
        value={tokenAddress}
        onChange={handleInput}
      />
    </div>
  )
}
