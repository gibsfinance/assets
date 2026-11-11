import { hashBytes } from '../hash'
import type { FetchFunction } from '../http'

/** What a gateway of the fake does when asked for content. */
export type GatewayBehavior = 'serves' | 'has-nothing' | 'serves-wrong-bytes' | 'is-down'

/** An IPFS pinning API and its gateways in memory, reached through an injected `fetch`. */
export type FakeIpfs = {
  fetch: FetchFunction
  /** Pinned content by CID. */
  pins: Map<string, Buffer>
  /** Every request, as `METHOD url`, in order. */
  requests: string[]
  /** Changes how one gateway host answers. */
  setGateway: (host: string, behavior: GatewayBehavior) => void
  /** The CID the fake gives to some bytes. Deliberately not a function of the sha256 alone. */
  cidOf: (bytes: Uint8Array) => string
  /** Makes the next requests to the API answer with a status. */
  failNext: (status: number, count?: number, body?: string) => void
  /** Makes the next add answer without a content identifier. */
  answerNextAddEmpty: () => void
}

/** Settings for {@link createFakeIpfs}. */
export type FakeIpfsOptions = {
  /** Address of a Kubo-style API, for example `https://kubo.example.test`. */
  kuboApi?: string
  /** Address of a Pinata-style API. */
  pinataApi?: string
  /** Bearer token the API requires, if any. */
  token?: string
}

/**
 * Builds a fake pinning service. A Kubo-style add must ask for CIDv1, raw leaves and 1 MiB
 * blocks, as the adapter promises; both styles must carry the bearer token when one is required.
 *
 * @param options See {@link FakeIpfsOptions}.
 */
export function createFakeIpfs(options: FakeIpfsOptions = {}): FakeIpfs {
  const { kuboApi = 'https://kubo.example.test', pinataApi = 'https://pinata.example.test', token } = options
  const pins = new Map<string, Buffer>()
  const requests: string[] = []
  const gateways = new Map<string, GatewayBehavior>()
  let failures: { status: number; count: number; body: string } | null = null
  let emptyAdd = false

  const cidOf = (bytes: Uint8Array): string => `bafkfake${hashBytes(bytes).split('').reverse().join('').slice(0, 48)}`

  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

  const bytesOfForm = async (body: unknown): Promise<Buffer> => {
    const file = (body as FormData).get('file') as Blob
    return Buffer.from(await file.arrayBuffer())
  }

  const fakeFetch: FetchFunction = async (input, init = {}) => {
    const url = new URL(input)
    const method = (init.method ?? 'GET').toUpperCase()
    requests.push(`${method} ${url.href}`)
    const apiHosts = [new URL(kuboApi).host, new URL(pinataApi).host]

    if (apiHosts.includes(url.host)) {
      if (failures && failures.count > 0) {
        failures.count -= 1
        return new Response(failures.body, { status: failures.status })
      }
      const authorization = new Headers(init.headers).get('authorization')
      if (token && authorization !== `Bearer ${token}`) return json({ Message: 'unauthorized' }, 401)
    }

    if (url.href.startsWith(`${kuboApi}/api/v0/add`)) {
      const wanted = url.searchParams
      const asPromised =
        wanted.get('cid-version') === '1' &&
        wanted.get('raw-leaves') === 'true' &&
        wanted.get('pin') === 'true' &&
        wanted.get('chunker') === 'size-1048576'
      if (!asPromised) return json({ Message: 'unexpected add options' }, 400)
      const bytes = await bytesOfForm(init.body)
      if (emptyAdd) {
        emptyAdd = false
        return json({ Name: 'blob' })
      }
      pins.set(cidOf(bytes), bytes)
      return new Response(
        `{"Name":"blob","Bytes":${bytes.length}}\n{"Name":"blob","Hash":"${cidOf(bytes)}","Size":"${bytes.length}"}\n`,
      )
    }
    if (url.href.startsWith(`${kuboApi}/api/v0/pin/rm`)) {
      const cid = url.searchParams.get('arg') as string
      if (!pins.delete(cid)) return json({ Message: 'not pinned or pinned indirectly' }, 500)
      return json({ Pins: [cid] })
    }
    if (url.href === `${pinataApi}/pinning/pinFileToIPFS`) {
      const form = init.body as FormData
      if (form.get('pinataOptions') !== '{"cidVersion":1}') return json({ error: 'cidVersion' }, 400)
      const bytes = await bytesOfForm(form)
      if (emptyAdd) {
        emptyAdd = false
        return json({})
      }
      pins.set(cidOf(bytes), bytes)
      return json({ IpfsHash: cidOf(bytes), PinSize: bytes.length })
    }
    if (url.href.startsWith(`${pinataApi}/pinning/unpin/`)) {
      const cid = decodeURIComponent(url.pathname.split('/').pop() as string)
      return pins.delete(cid) ? json({}) : json({ error: 'not found' }, 404)
    }

    const behavior = gateways.get(url.host) ?? 'serves'
    const cid = decodeURIComponent(url.pathname.split('/').pop() as string)
    if (behavior === 'is-down') return new Response('unavailable', { status: 503 })
    if (behavior === 'has-nothing' || !pins.has(cid)) return new Response('not found', { status: 404 })
    const content = pins.get(cid) as Buffer
    if (behavior === 'serves-wrong-bytes')
      return new Response(new Uint8Array(Buffer.from(`not ${content.toString('latin1')}`, 'latin1')))
    return new Response(new Uint8Array(content))
  }

  return {
    fetch: fakeFetch,
    pins,
    requests,
    cidOf,
    setGateway: (host, behavior) => {
      gateways.set(host, behavior)
    },
    failNext: (status, count = 1, body = '') => {
      failures = { status, count, body }
    },
    answerNextAddEmpty: () => {
      emptyAdd = true
    },
  }
}
