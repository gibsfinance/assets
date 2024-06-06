import * as utils from '../utils'
import * as fs from 'fs'
import * as path from 'path'
import * as internetmoney from './internetmoney'
import * as remoteTokenList from './remote-tokenlist'
import * as phux from './phux'
import * as github from './github'
import * as trustwallet from './trustwallet'
import _ from 'lodash'

export const main = async () => {
  const filePaths = await Promise.all([
    trustwallet.collect(),
    remoteTokenList.collect({
      providerKey: 'piteas',
      tokenList: 'https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json',
    }),
    remoteTokenList.collect({
      providerKey: 'pulsex',
      tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
    }),
    internetmoney.scrape(),
    phux.collect(),
    github.collect(),
  ])
  const relativePaths = _(filePaths)
    .flatten().compact()
    .map(utils.pathFromOutRoot)
    .value()
  fs.writeFileSync(path.join(utils.root, 'index.json'), JSON.stringify(relativePaths, null, 2))
}
