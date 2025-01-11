import * as remoteTokenList from './remote-tokenlist'

const arbitrumOne = remoteTokenList.collect({
  providerKey: 'coingecko',
  listKey: 'arbitrum-one',
  tokenList: 'https://tokens.coingecko.com/arbitrum-one/all.json',
})

const uniswap = remoteTokenList.collect({
  providerKey: 'coingecko',
  listKey: 'uniswap',
  tokenList: 'https://tokens.coingecko.com/uniswap/all.json',
})

const zksync = remoteTokenList.collect({
  providerKey: 'coingecko',
  listKey: 'zksync',
  tokenList: 'https://tokens.coingecko.com/zksync/all.json',
})

export const collect = async () => {
  await Promise.all([arbitrumOne(), uniswap(), zksync()])
}
