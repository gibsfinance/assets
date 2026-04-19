import * as viem from 'viem'
import { erc20Read } from '@gibs/utils'
import * as inmemory from './inmemory-tokenlist'
import { pulsechain, pulsechainV4 } from 'viem/chains'
import * as utils from '../utils'
import { minimalList } from '../server/list/utils'
import * as remoteTokenList from './remote-tokenlist'
import * as db from '../db'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'pulsex'

const pulsexConfig = new Map<
  viem.Chain,
  {
    domain: string
    isDefault: boolean
    targets: Set<viem.Hex>
  }
>([
  [
    pulsechain,
    {
      domain: 'tokens.app.pulsex.com',
      isDefault: false,
      targets: new Set([
        '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
        '0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
        '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
        '0xefd766ccb38eaf1dfd701853bfce31359239f305',
        '0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07',
        '0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f',
        '0x57fde0a71132198bbec939b98976993d8d89d225',
        '0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c',
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        '0xb17d901469b9208b17d916112988a3fed19b5ca1',
        '0x4d3aea379b7689e0cb722826c909fab39e54123d',
        '0x6982508145454ce325ddbe47a25d4ec3d2311933',
        '0x514910771af9ca656af840dff83e8264ecf986ca',
        '0xee2d275dbb79c7871f8c6eb2a4d0687dd85409d1',
        '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
        '0x3f105121a10247de9a92e818554dd5fcd2063ae7',
      ]),
    },
  ],
  [
    pulsechainV4,
    {
      domain: 'tokens.app.v4.testnet.pulsex.com',
      isDefault: false,
      targets: new Set([
        '0x70499adebb11efd915e3b69e700c331778628707',
        '0x8a810ea8b121d08342e9e7696f4a9915cbe494b7',
        '0x6efafcb715f385c71d8af763e8478feea6fadf63',
        '0x826e4e896cc2f5b371cd7bb0bd929db3e3db67c0',
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        '0xdac17f958d2ee523a2206206994597c13d831ec7',
      ]),
    },
  ],
])

const listKeys = [
  'extended',
  'extended-composite',
  'v0.1.2',
  'v0.1.2-composite',
  'v4-v0.1.2',
  'v4-v0.1.2-composite',
  'inline',
] as const

// Keep upstream EIP-55 casing for logo URL paths (matches the tokenlist JSON);
// lowercase casing for the address flowing to the DB as providedId.
const plsMainImg = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27'
const plsMainAddress = plsMainImg.toLowerCase() as viem.Hex
const plsV4Address = '0x70499adebb11efd915e3b69e700c331778628707' as viem.Hex

class PulsexCollector extends BaseCollector {
  readonly key = 'pulsex'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    await db.insertProvider({
      key: providerKey,
      name: 'PulseX',
      description: 'the pulsex token list hosted in their code',
    })

    return [
      {
        providerKey,
        lists: listKeys.map((listKey) => ({ listKey })),
      },
    ]
  }

  async collect(signal: AbortSignal): Promise<void> {
    await db.insertProvider({
      key: providerKey,
      name: 'PulseX',
      description: 'the pulsex token list hosted in their code',
    })

    const inlineTokensMainnet = Array.from(pulsexConfig.get(pulsechain)!.targets).map((address) => {
      return {
        address,
        logoURI: `https://tokens.app.pulsex.com/images/tokens/${address}.png`,
        network: {
          id: pulsechain.id,
          isNetworkImage: false,
        },
      }
    })
    const inlineTokensV4 = Array.from(pulsexConfig.get(pulsechainV4)!.targets).map((address) => {
      return {
        address,
        logoURI: `https://tokens.app.v4.testnet.pulsex.com/images/tokens/${address}.png`,
        network: {
          id: pulsechainV4.id,
          isNetworkImage: false,
        },
      }
    })
    const remoteListOriginal = remoteTokenList.collect({
      providerKey: 'pulsex',
      listKey: 'extended',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
      isDefault: false,
      extension: [
        {
          address: plsMainAddress,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: 369,
            isNetworkImage: true,
          },
        },
      ],
    })
    const remoteListOriginalComposite = remoteTokenList.collect({
      providerKey: 'pulsex',
      listKey: 'extended-composite',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
      isDefault: false,
      extension: [
        {
          address: plsMainAddress,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: 369,
            isNetworkImage: true,
          },
        },
        ...inlineTokensMainnet.filter((token) => token.address !== plsMainAddress),
      ],
    })

    const remoteListV1_0_2Mainnet = remoteTokenList.collect({
      providerKey: 'pulsex',
      listKey: 'v0.1.2',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended-v0.1.2.tokenlist.json',
      isDefault: false,
      extension: [
        {
          address: plsMainAddress,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: pulsechain.id,
            isNetworkImage: true,
          },
        },
      ],
    })
    const remoteListV1_0_2MainnetComposite = remoteTokenList.collect({
      providerKey: 'pulsex',
      listKey: 'v0.1.2-composite',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended-v0.1.2.tokenlist.json',
      isDefault: true,
      extension: [
        {
          address: viem.zeroAddress,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          name: 'Pulse',
          symbol: 'PLS',
          decimals: 18,
          network: {
            id: pulsechain.id,
            isNetworkImage: true,
          },
        },
        {
          address: plsMainAddress,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: pulsechain.id,
            isNetworkImage: false,
          },
        },
        ...inlineTokensMainnet.filter((token) => token.address !== plsMainAddress),
      ],
    })
    const remoteListV1_0_2V4 = remoteTokenList.collect({
      providerKey: 'pulsex',
      listKey: 'v4-v0.1.2',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended-v0.1.2.tokenlist.json',
      isDefault: false,
      extension: [
        {
          address: plsV4Address,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: pulsechainV4.id,
            isNetworkImage: true,
          },
        },
      ],
    })
    const remoteListV1_0_2V4Composite = remoteTokenList.collect({
      providerKey: 'pulsex',
      listKey: 'v4-v0.1.2-composite',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended-v0.1.2.tokenlist.json',
      isDefault: false,
      extension: [
        {
          address: viem.zeroAddress,
          name: 'V4 Pulse',
          symbol: 'V4PLS',
          decimals: 18,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: pulsechainV4.id,
            isNetworkImage: true,
          },
        },
        {
          address: plsV4Address,
          logoURI: `https://tokens.app.pulsex.com/images/tokens/${plsMainImg}.png`,
          network: {
            id: pulsechainV4.id,
            isNetworkImage: false,
          },
        },
        ...inlineTokensV4.filter((token) => token.address !== plsV4Address),
      ],
    })

    await Promise.all([
      // lists
      remoteListOriginal(signal),
      remoteListV1_0_2Mainnet(signal),
      remoteListV1_0_2V4(signal),
      // original lists + inline/hardcoded tokens
      remoteListOriginalComposite(signal),
      remoteListV1_0_2MainnetComposite(signal),
      remoteListV1_0_2V4Composite(signal),
      // hardcoded tokens
      ...[...pulsexConfig.entries()].map(async ([chain, config]) => {
        const client = utils.chainToPublicClient(chain)
        const targets = [...config.targets.values()]
        const tokens = await Promise.all(targets.map((target) => erc20Read(chain, client, target)))
        const list = tokens.map(([name, symbol, decimals], index) => {
          return {
            name,
            symbol,
            decimals,
            chainId: chain.id,
            address: targets[index],
            logoURI: `https://${config.domain}/images/tokens/${targets[index]}.png`,
          }
        })
        await inmemory.collect({
          providerKey: 'pulsex',
          listKey: 'inline',
          tokenList: minimalList(list),
          isDefault: config.isDefault,
          signal,
        })
      }),
    ])
  }
}

const instance = new PulsexCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
