import * as viem from 'viem'
import * as inmemory from './inmemory-tokenlist'
import { pulsechain } from 'viem/chains'
import * as utils from '../utils'
import { minimalList } from '@/server/list/utils'
import * as remoteTokenList from './remote-tokenlist'
import { getDB } from '@/db'
import { tableNames } from '@/db/tables'

const remoteList = remoteTokenList.collect({
  providerKey: 'pulsex',
  listKey: 'exchange',
  tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
  isDefault: false,
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

export const collect = async () => {
  const client = viem.createPublicClient({
    chain: pulsechain,
    transport: viem.http(),
  })
  const targetSet = new Set<viem.Hex>([
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
  ])
  const targets = [...targetSet.values()]
  const tokens = await Promise.all(targets.map((target) => utils.erc20Read(pulsechain, client, target)))
  const list = tokens.map(([name, symbol, decimals], index) => {
    return {
      name,
      symbol,
      decimals,
      chainId: pulsechain.id,
      address: targets[index],
      logoURI: `https://tokens.app.pulsex.com/images/tokens/${targets[index]}.png`,
    }
  })
  const [provider] = await getDB().select('*')
    .from(tableNames.provider)
    .where('key', 'pulsex')
  if (provider) {
    await getDB().update({
      default: false,
    }).from(tableNames.list)
      .where({
        providerId: provider.providerId,
      })
      .whereNotIn('listKey', ['inline'])
  }
  await inmemory.collect('pulsex', 'inline', minimalList(list))
  await remoteList()
}
