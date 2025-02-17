import * as remoteTokenList from './remote-tokenlist'

const baofinance = remoteTokenList.collect({
  providerKey: 'baofinance',
  listKey: 'xdai',
  tokenList: 'https://raw.githubusercontent.com/baofinance/tokenlists/main/xdai.json',
})

export const collect = async () => {
  await Promise.all([baofinance()])
}
