import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../types'
import { countSupportedNetworks } from './network-metrics'
import networksJson from '../networks.json'

const generated = networksJson as Record<string, string>

/**
 * countSupportedNetworks resolves each name through getNetworkName(chainIdentifier)
 * and ignores whatever `name` a fixture carries, so the excluded case has to name a
 * chain the generated map really does call a testnet. Deriving that id keeps this test
 * from rotting the way a hard-coded chain 9 did: it read as a testnet only because the
 * vendored registry snapshot happened to call it "Ubiq Network Testnet", and a regen
 * silently flipped it to "Quai Network Mainnet" — changing the count while the fixture
 * still claimed to be a testnet.
 */
const testnetEntry = Object.entries(generated).find(([, name]) => name.toLowerCase().includes('testnet'))
if (!testnetEntry) throw new Error('networks.json has no testnet-named chain to exercise the exclusion')
const [testnetChainId, testnetChainName] = testnetEntry

describe('countSupportedNetworks', () => {
  it('counts chains with tokens or a logo, excluding testnets', () => {
    const nets = [
      {
        name: 'Ethereum',
        tokenCount: 100,
        hasImage: true,
        chainId: 1,
        chainIdentifier: 'eip155-1',
        type: 'evm',
        isEvm: true,
      },
      {
        name: 'Bitcoin',
        tokenCount: 0,
        hasImage: true,
        chainId: 0,
        chainIdentifier: 'bip122-0',
        type: 'bip122',
        isEvm: false,
      }, // logo-only -> counts
      {
        name: 'Ghost',
        tokenCount: 0,
        hasImage: false,
        chainId: 999999,
        chainIdentifier: 'eip155-999999',
        type: 'evm',
        isEvm: true,
      }, // neither -> excluded
      {
        name: testnetChainName,
        tokenCount: 5,
        hasImage: true,
        chainId: Number(testnetChainId),
        chainIdentifier: `eip155-${testnetChainId}`,
        type: 'evm',
        isEvm: true,
      }, // testnet -> excluded
    ] as NetworkInfo[]
    expect(countSupportedNetworks(nets)).toBe(2)
  })

  // Guards the derivation above: if the chain this test picked ever stopped reading as
  // a testnet, the count assertion would quietly drift from 2 to 3 rather than fail on
  // the thing that actually broke.
  it('resolves the derived exclusion fixture to a testnet name', () => {
    expect(generated[testnetChainId].toLowerCase()).toContain('testnet')
  })
})
