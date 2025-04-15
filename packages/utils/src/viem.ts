import {
  type Hex,
  type Chain,
  type Abi,
  getContract,
  multicall3Abi,
  encodeFunctionData,
  decodeFunctionResult,
  PublicClient,
  erc20Abi,
  erc20Abi_bytes32,
  fromHex,
} from 'viem'
import type * as types from './types'

/**
 * Multicall contract reader with enhanced error handling
 */
export const multicallRead = async <T>({
  chain,
  client,
  abi,
  calls,
  target,
}: {
  chain: Chain
  client: PublicClient
  abi: Abi
  calls: types.Call[]
  target?: Hex
}) => {
  const multicall = getContract({
    abi: multicall3Abi,
    address: chain.contracts!.multicall3!.address!,
    client,
  })
  const arg = calls.map((call) => ({
    callData: encodeFunctionData({
      abi: call.abi || abi,
      functionName: call.functionName,
      args: call.args || [],
    }),
    allowFailure: call.allowFailure || false,
    target: (call.target || target) as Hex,
  }))
  const reads = await multicall.read.aggregate3([arg])
  return calls.map((call, i) =>
    decodeFunctionResult({
      abi: call.abi || abi,
      functionName: call.functionName,
      data: reads[i].returnData,
    }),
  ) as T
}

/**
 * ERC20 token data reader with fallback support
 */
export const erc20Read = async (
  chain: Chain,
  client: PublicClient,
  target: Hex,
  { skipBytes32 = false, mustExist = false }: { skipBytes32?: boolean; mustExist?: boolean } = {},
) => {
  const calls = [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }]
  return await multicallRead<types.TokenChainInfo>({
    chain,
    client,
    abi: erc20Abi,
    calls,
    target,
  })
    .catch(async (err) => {
      if (skipBytes32) {
        throw err
      }
      return await multicallRead<[Hex, Hex, number]>({
        chain,
        client,
        abi: erc20Abi_bytes32,
        calls,
        target,
      }).then(
        ([name, symbol, decimals]) =>
          [
            fromHex(name, 'string').split('\x00').join(''),
            fromHex(symbol, 'string').split('\x00').join(''),
            decimals,
          ] as types.TokenChainInfo,
      )
    })
    .catch(() => {
      if (mustExist) {
        throw new Error('unable to read token')
      }
      return ['', '', 18] as types.TokenChainInfo
    })
}
