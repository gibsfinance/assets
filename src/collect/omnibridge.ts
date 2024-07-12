import * as viem from 'viem'
type BridgeSideConfig = {
  address: viem.Hex
  chain: viem.Chain
  startBlock: number
}
type BridgeConfig = {
  provider: string
  home: BridgeSideConfig
  foreign: BridgeSideConfig
}
export const collect = (config: BridgeConfig[]) => async () => {
  await Promise.all(config.map(collectByBridgeConfig))
}

export const collectByBridgeConfig = async (config: BridgeConfig) => {
  console.log('todo: %o home=%o foreign=%o', config.provider, config.home.chain.id, config.foreign.chain.id)
}
