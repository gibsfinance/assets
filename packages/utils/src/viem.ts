import {
  type Hex,
  type Chain,
  type Abi,
  type Transport,
  type EIP1193RequestFn,
  getContract,
  multicall3Abi,
  encodeFunctionData,
  decodeFunctionResult,
  PublicClient,
  erc20Abi,
  erc20Abi_bytes32,
  fromHex,
  http,
  createTransport,
  shouldThrow,
  createPublicClient,
} from 'viem'
import type * as types from './types'

const rpcTimeout = 5_000

const defaultRpcOverrides: Record<number, string[]> = {
  1: ['https://cloudflare-eth.com', 'https://ethereum.publicnode.com', 'https://eth.llamarpc.com'],
  250: ['https://1rpc.io/ftm'],
}

/** A single RPC endpoint and its share of the request rotation. */
export type RpcEndpoint = {
  url: string
  /** Relative share of requests. Higher values receive proportionally more. */
  weight: number
}

/**
 * Separates an endpoint URL from its optional weight. `|` is reserved in URLs
 * (RFC 3986 §2.2) and must be percent-encoded, so it never collides with a real
 * endpoint.
 */
const WEIGHT_SEPARATOR = '|'

/**
 * Parse one endpoint spec into a URL and a weight.
 *
 * Syntax: `<url>` or `<url>|<weight>` — for example
 * `https://fast.example.com|3`. Weight defaults to 1, so an unsuffixed list
 * stays plain equal round-robin and existing configuration is unaffected.
 *
 * @param spec - A single entry from an `RPC_<chainId>` list.
 * @throws If a weight suffix is present but is not a positive finite number.
 * A silently-ignored weight would look like it applied while doing nothing,
 * so a malformed one fails loudly at startup instead.
 */
export const parseRpcEndpoint = (spec: string): RpcEndpoint => {
  const separator = spec.lastIndexOf(WEIGHT_SEPARATOR)
  if (separator === -1) return { url: spec.trim(), weight: 1 }

  const url = spec.slice(0, separator).trim()
  const rawWeight = spec.slice(separator + 1).trim()
  const weight = Number(rawWeight)
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`invalid RPC endpoint weight "${rawWeight}" for ${url} — expected a positive number`)
  }
  return { url, weight }
}

/** Parse a list of endpoint specs, as read from an `RPC_<chainId>` variable. */
export const parseRpcEndpoints = (specs: readonly string[]): RpcEndpoint[] => specs.map(parseRpcEndpoint)

/**
 * Strip any weight suffixes, leaving plain URLs.
 *
 * Chain configs (`chain.rpcUrls.default.http`) hold URLs only — a weight suffix
 * reaching viem through one of those would be a malformed endpoint.
 */
export const rpcEndpointUrls = (specs: readonly string[]): string[] => specs.map((spec) => parseRpcEndpoint(spec).url)

/**
 * Weighted round-robin load-balancing transport with failover.
 *
 * viem's built-in `fallback` transport is failover-only: every request hits the
 * first endpoint and only moves on when one errors, so it never spreads load.
 * This transport distributes requests across all endpoints instead —
 * multiplying the combined rate-limit headroom during a large collect run —
 * while still falling through the remaining endpoints whenever one fails.
 *
 * Distribution uses smooth weighted round-robin (the algorithm nginx uses):
 * each pick credits every endpoint by its weight, serves the richest, then
 * debits that one by the total. This interleaves the rotation rather than
 * clustering it, so a 3:1 split cycles A,A,B,A instead of A,A,A,B and
 * consecutive requests keep spreading. Equal weights reduce to plain
 * round-robin.
 *
 * Error handling reuses viem's own `shouldThrow`: node-level answers (execution
 * reverts, user rejections) propagate immediately rather than being pointlessly
 * retried against every other endpoint, whereas connection failures and rate
 * limits (for example a 429) fail over to the next endpoint in the rotation.
 *
 * @param endpoints - The endpoints to balance across (two or more).
 * @param options - Per-endpoint request timeout in milliseconds.
 */
export const loadBalance =
  (endpoints: readonly RpcEndpoint[], { timeout }: { timeout: number }): Transport =>
  (params) => {
    // Instantiate each endpoint once (http transports are stateless closures);
    // retryCount 0 lets a failing endpoint fail over immediately rather than
    // retrying the same dead node before the rotation moves on.
    const transports = endpoints.map(({ url }) => http(url, { timeout, retryCount: 0 })(params))
    const weights = endpoints.map(({ weight }) => weight)
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    const credits = weights.map(() => 0)

    /** Smooth weighted round-robin: credit every endpoint, serve the richest, debit it. */
    const nextIndex = () => {
      let best = 0
      for (let index = 0; index < credits.length; index++) {
        credits[index] += weights[index]
        if (credits[index] > credits[best]) best = index
      }
      credits[best] -= totalWeight
      return best
    }

    return createTransport(
      {
        key: 'loadBalance',
        name: 'Weighted round-robin load balancer',
        type: 'loadBalance',
        // Let viem's retry wrapper re-run the whole rotation on retriable errors;
        // each retry re-picks, so a retry also lands on a fresh endpoint.
        retryCount: params.retryCount,
        request: (async (args: Parameters<EIP1193RequestFn>[0]) => {
          const start = nextIndex()
          const tryEndpoint = async (offset: number): Promise<unknown> => {
            const transport = transports[(start + offset) % transports.length]
            try {
              return await transport.request(args)
            } catch (error) {
              if (shouldThrow(error as Error)) throw error
              if (offset === transports.length - 1) throw error
              return tryEndpoint(offset + 1)
            }
          }
          return tryEndpoint(0)
        }) as EIP1193RequestFn,
      },
      { transports },
    )
  }

/**
 * Build a viem transport for a chain.
 *
 * Priority: RPC_{chainId} env var (comma-separated) > hardcoded overrides >
 * chain defaults. Each entry may carry an optional `|<weight>` suffix (see
 * {@link parseRpcEndpoint}) to take a larger share of the rotation — e.g.
 * `RPC_369="https://beefy.example.com|3,https://small.example.com"`.
 *
 * A single resolved endpoint uses a plain http transport; multiple endpoints
 * use the weighted {@link loadBalance} transport (load balancing plus failover).
 */
export const buildTransport = (chain: Chain) => {
  const envKey = `RPC_${chain.id}`
  const envSpecs = process.env[envKey]?.split(',').filter(Boolean)
  const specs = envSpecs?.length ? envSpecs : (defaultRpcOverrides[chain.id] ?? chain.rpcUrls.default.http)
  const endpoints = parseRpcEndpoints(specs)

  if (endpoints.length === 1) {
    return http(endpoints[0].url, { timeout: rpcTimeout })
  }

  return loadBalance(endpoints, { timeout: rpcTimeout })
}

const defaultBatchSettings = {
  multicall: {
    batchSize: 32,
    wait: 0,
  },
}

/**
 * Create a viem public client for a chain with fallback RPC load balancing.
 */
export const createChainClient = (chain: Chain): PublicClient => {
  return createPublicClient({
    chain,
    transport: buildTransport(chain),
    batch: defaultBatchSettings,
  }) as PublicClient
}

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
const erc20ReadTimeout = 15_000

export const erc20Read = async (
  chain: Chain,
  client: PublicClient,
  target: Hex,
  {
    skipBytes32 = false,
    mustExist = false,
    signal,
  }: { skipBytes32?: boolean; mustExist?: boolean; signal?: AbortSignal } = {},
) => {
  if (signal?.aborted) throw signal.reason
  const calls = [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }]
  const result = Promise.race([
    multicallRead<types.TokenChainInfo>({
      chain,
      client,
      abi: erc20Abi,
      calls,
      target,
    }).catch(async (err) => {
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
    }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`erc20Read timeout: ${chain.id} ${target}`)), erc20ReadTimeout)
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(signal.reason)
        },
        { once: true },
      )
    }),
  ])
  return await result.catch((err) => {
    if (signal?.aborted) throw signal.reason
    if (mustExist) {
      throw new Error('unable to read token')
    }
    return ['', '', 18] as types.TokenChainInfo
  })
}
