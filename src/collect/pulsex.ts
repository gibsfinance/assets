import * as viem from 'viem'
import * as inmemory from './inmemory-tokenlist'
import { pulsechain, pulsechainV4 } from 'viem/chains'
import * as utils from '../utils'
import { minimalList } from '@/server/list/utils'
import * as remoteTokenList from './remote-tokenlist'
import * as db from '@/db'

const remoteList = remoteTokenList.collect({
  providerKey: 'pulsex',
  listKey: 'extended',
  tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
  isDefault: true,
  extension: [
    {
      address: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
      logoURI: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png',
      network: {
        id: 369,
        isNetworkImage: true,
      },
    },
  ],
})

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
      isDefault: true,
      targets: new Set([
        '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
        '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d',
        '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39',
        '0xefD766cCb38EaF1dfd701853BFCe31359239F305',
        '0x15D38573d2feeb82e7ad5187aB8c1D52810B1f07',
        '0x0Cb6F5a34ad42ec934882A05265A7d5F59b51A2f',
        '0x57fde0a71132198BBeC939B98976993d8D89D225',
        '0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C',
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        '0xb17D901469B9208B17d916112988A3FeD19b5cA1',
        '0x4d3AeA379b7689E0Cb722826C909Fab39E54123d',
        '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
        '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        '0xEe2D275Dbb79c7871F8C6eB2A4D0687dD85409D1',
        '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
        '0x3f105121A10247DE9a92e818554DD5Fcd2063AE7',
      ]),
    },
  ],
  [
    pulsechainV4,
    {
      domain: 'tokens.app.v4.testnet.pulsex.com',
      isDefault: false,
      targets: new Set([
        '0x70499adEBB11Efd915E3b69E700c331778628707',
        '0x8a810ea8B121d08342E9e7696f4a9915cBE494B7',
        '0x6eFAfcb715F385c71d8AF763E8478FeEA6faDF63',
        '0x826e4e896CC2f5B371Cd7Bb0bd929DB3e3DB67c0',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      ]),
    },
  ],
])

export const collect = async () => {
  await db.insertProvider({
    key: 'pulsex',
    name: 'PulseX',
    description: 'the pulsex token list hosted in their code',
  })
  await Promise.all([
    remoteList(),
    ...[...pulsexConfig.entries()].map(async ([chain, config]) => {
      const client = viem.createPublicClient({
        chain,
        transport: viem.http(),
      })
      const targets = [...config.targets.values()]
      const tokens = await Promise.all(targets.map((target) => utils.erc20Read(pulsechain, client, target)))
      const list = tokens.map(([name, symbol, decimals], index) => {
        return {
          name,
          symbol,
          decimals,
          chainId: pulsechain.id,
          address: targets[index],
          logoURI: `https://${config.domain}/images/tokens/${targets[index]}.png`,
        }
      })
      await inmemory.collect('pulsex', 'inline', minimalList(list), config.isDefault)
    }),
  ])
}
