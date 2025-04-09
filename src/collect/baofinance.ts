import * as remoteTokenList from './remote-tokenlist'

const baofinance = remoteTokenList.collect({
  providerKey: 'baofinance',
  listKey: 'xdai',
  tokenList: 'https://raw.githubusercontent.com/baofinance/tokenlists/main/xdai.json',
  blacklist: new Set(['0x4537e328bf7e4efa29d05caea260d7fe26af9d74']),
})

export const collect = async () => {
  await Promise.all([baofinance()])
}
