import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'dfyn',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/dfyn/new-host/main/list-token.tokenlist.json',
  blacklist: new Set([
    '0x94788309D420ad9f9f16d79fC13Ab74de83f85F7',
    '0xAcD7B3D9c10e97d0efA418903C0c7669E702E4C0',
    '0x3A3e7650f8B9f667dA98F236010fBf44Ee4B2975',
    '0x3Dc7B06dD0B1f08ef9AcBbD2564f8605b4868EEA',
    '0xF4B0903774532AEe5ee567C02aaB681a81539e92',
    '0xbc7cB585346f4F59d07121Bb9Ed7358076243539',
  ]),
})
