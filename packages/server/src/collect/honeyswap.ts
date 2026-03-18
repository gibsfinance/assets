import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'honeyswap',
  listKey: 'exchange',
  tokenList: 'https://tokens.honeyswap.org/',
  blacklist: new Set([
    '0xfC40a4F89b410a1b855b5e205064a38fC29F5eb5',
    '0x0e59D50adD2d90f5111aca875baE0a72D95B4762',
    '0xde485931674F4EdD3Ed3bf22e86E7d3C7D5347a1',
    '0x7ff2FC33E161E3b1C6511B934F0209D304267857',
    '0xaECeBfcF604AD245Eaf0D5BD68459C3a7A6399c2',
  ]),
})
