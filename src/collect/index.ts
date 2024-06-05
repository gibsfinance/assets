import * as utils from '../utils'
import * as fs from 'fs'
import * as path from 'path'
import * as internetmoney from './internetmoney'
import * as remoteTokenList from './remote-tokenlist'
import * as phux from './phux'
import * as github from './github'

export const main = async () => {
  const filePaths = await Promise.all([
    internetmoney.scrape(),
    remoteTokenList.collect({
      providerKey: 'piteas',
      tokenList: 'https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json',
    }),
    remoteTokenList.collect({
      providerKey: 'pulsex',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
    }),
    phux.collect(),
    github.collect({
      // owner: 'PLS369',
      // name: 'pulsechain-assets',
      // paths: [{
      //   path: 'blockchain/pulsechain/assets',
      //   filter: (item) => { },
      // }],
    }),
  ])
  const relativePaths = filePaths.map(utils.pathFromOutRoot)
  fs.writeFileSync(path.join(utils.root, 'index.json'), JSON.stringify(relativePaths, null, 2))
}
