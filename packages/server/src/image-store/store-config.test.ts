import { generateKeyPairSync } from 'node:crypto'
import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryCidIndex } from './__testing__/memory-cid-index'
import { ImageStoreConfigurationError } from './configuration-error'
import { hashBytes } from './hash'
import { createBlobStoreFromSpec, parseByteSize, parseStoreSpecText, type StoreBuildContext } from './store-config'

vi.mock('../logger', () => ({ log: vi.fn() }))

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fileSystem.rm(directory, { recursive: true, force: true })),
  )
})
const temporaryDirectory = async (): Promise<string> => {
  const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-store-config-'))
  directories.push(directory)
  return directory
}

/** Answers every request with 404 and records the address, so a test can see where a store points. */
const recordingFetch = () => {
  const requested: string[] = []
  const fetch = async (input: string | URL) => {
    requested.push(String(input))
    return new Response('{}', { status: 404 })
  }
  return { fetch, requested }
}

const context = (
  environment: Record<string, string> = {},
  extra: Partial<StoreBuildContext> = {},
): StoreBuildContext => ({
  environment,
  defaultLocalDirectory: '/unused-default',
  retries: 0,
  ...extra,
})

const SHA = hashBytes(Buffer.from('x'))
const message = (
  spec: unknown,
  environment: Record<string, string> = {},
  extra: Partial<StoreBuildContext> = {},
): string => {
  try {
    createBlobStoreFromSpec(spec as never, context(environment, extra))
  } catch (error) {
    expect(error).toBeInstanceOf(ImageStoreConfigurationError)
    return (error as Error).message
  }
  throw new Error('expected a configuration error')
}

describe('parseByteSize', () => {
  it.each([
    [1024, 1024],
    ['2048', 2048],
    ['5GiB', 5 * 1024 ** 3],
    [' 3 MiB ', 3 * 1024 ** 2],
    ['1TiB', 1024 ** 4],
    ['4KiB', 4096],
    ['7B', 7],
  ])('reads %j as %d bytes', (value, bytes) => {
    expect(parseByteSize(value)).toBe(bytes)
  })

  it.each([0, -5, 1.5, Number.NaN, '', 'GiB', '5GB', '1.5GiB', '-1', null, undefined, {}, '9999999999999999TiB'])(
    'refuses %j',
    (value) => {
      expect(parseByteSize(value)).toBeNull()
    },
  )
})

describe('parseStoreSpecText', () => {
  it('reads a kind name, trimmed', () => {
    expect(parseStoreSpecText('  s3 \n')).toEqual({ type: 's3' })
  })

  it('reads JSON', () => {
    expect(parseStoreSpecText('{"type":"s3","bucket":"b"}')).toEqual({ type: 's3', bucket: 'b' })
  })

  it('refuses JSON that does not parse, naming the setting', () => {
    expect(() => parseStoreSpecText('{"type":')).toThrow(/^IMAGE_STORE is not valid JSON/)
  })

  it('refuses a JSON object with no type', () => {
    expect(() => parseStoreSpecText('{"bucket":"b"}')).toThrow('IMAGE_STORE: the "type" is missing')
  })
})

describe('createBlobStoreFromSpec: local', () => {
  it('builds a directory store at the default directory, and at a named one', async () => {
    const defaultDirectory = await temporaryDirectory()
    const named = await temporaryDirectory()
    const first = createBlobStoreFromSpec('local', context({}, { defaultLocalDirectory: defaultDirectory }))
    const second = createBlobStoreFromSpec({ type: 'local', dir: named }, context())

    const { sha256 } = await first.put(Buffer.from('default'))
    await second.put(Buffer.from('named'))

    expect(await fileSystem.stat(path.join(defaultDirectory, 'sha256', sha256.slice(0, 2), sha256))).toBeTruthy()
    expect(await fileSystem.readdir(path.join(named, 'sha256'))).toHaveLength(1)
  })

  it('reads the directory from IMAGE_STORE_DIR', async () => {
    const directory = await temporaryDirectory()
    const store = createBlobStoreFromSpec('local', context({ IMAGE_STORE_DIR: directory }))

    await store.put(Buffer.from('from the environment'))

    expect(await fileSystem.readdir(path.join(directory, 'sha256'))).toHaveLength(1)
  })

  it('uses the prefix a spec names for its environment variables', async () => {
    const directory = await temporaryDirectory()
    const store = createBlobStoreFromSpec({ type: 'local', envPrefix: 'CACHE_' }, context({ CACHE_DIR: directory }))

    await store.put(Buffer.from('prefixed'))

    expect(await fileSystem.readdir(path.join(directory, 'sha256'))).toHaveLength(1)
  })

  it('logs a failed sweep of old temporary files instead of throwing', async () => {
    const directory = await temporaryDirectory()
    const blocker = path.join(directory, 'blocker')
    await fileSystem.writeFile(blocker, 'a file where a directory belongs')

    expect(() => createBlobStoreFromSpec({ type: 'local', dir: blocker }, context())).not.toThrow()
  })

  it('refuses a setting that is not text, and a setting nothing reads', () => {
    expect(message({ type: 'local', dir: 5, colour: 'red' })).toBe(
      'IMAGE_STORE (local): "dir" must be text; unknown setting "colour"',
    )
  })

  it('refuses an unknown kind and lists the valid ones', () => {
    expect(message('floppy')).toBe(
      'IMAGE_STORE: unknown store type "floppy"; use one of local, s3, gcs, azure, ipfs, tiered, mirrored, fallback',
    )
  })
})

describe('createBlobStoreFromSpec: s3', () => {
  const environment = {
    IMAGE_STORE_S3_BUCKET: 'my-bucket',
    IMAGE_STORE_S3_ACCESS_KEY_ID: 'id',
    IMAGE_STORE_S3_SECRET_ACCESS_KEY: 'secret',
  }

  it('builds an AWS store from the environment alone', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      's3',
      context({ ...environment, IMAGE_STORE_S3_REGION: 'eu-west-1' }, { fetch }),
    )

    await store.stat(SHA)

    expect(requested[0]).toBe(`https://my-bucket.s3.eu-west-1.amazonaws.com/sha256/${SHA.slice(0, 2)}/${SHA}`)
  })

  it('builds a Cloudflare R2 store, with a key prefix, a session token and settings written in the spec', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      { type: 's3', preset: 'r2', accountId: 'acct', prefix: 'images/', addressing: 'path' },
      context({ ...environment, IMAGE_STORE_S3_SESSION_TOKEN: 'temporary' }, { fetch }),
    )

    await store.stat(SHA)

    expect(requested[0]).toBe(`https://acct.r2.cloudflarestorage.com/my-bucket/images/sha256/${SHA.slice(0, 2)}/${SHA}`)
  })

  it('builds a MinIO store at a custom endpoint', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      { type: 's3', preset: 'minio', endpoint: 'http://localhost:9000' },
      context(environment, { fetch }),
    )

    await store.stat(SHA)

    expect(requested[0]).toMatch(/^http:\/\/localhost:9000\/my-bucket\/sha256\//)
  })

  it('names every missing setting at once, with the variable to set', () => {
    expect(message('s3')).toBe(
      'IMAGE_STORE (s3): set IMAGE_STORE_S3_BUCKET (or "bucket" in IMAGE_STORE); set IMAGE_STORE_S3_ACCESS_KEY_ID; set IMAGE_STORE_S3_SECRET_ACCESS_KEY',
    )
  })

  it('refuses a secret written in the spec, without repeating its value', () => {
    const text = message({ type: 's3', secretAccessKey: 'TOP-SECRET-VALUE' }, environment)

    expect(text).toBe(
      'IMAGE_STORE (s3): "secretAccessKey" is a secret: set IMAGE_STORE_S3_SECRET_ACCESS_KEY in the environment, not in IMAGE_STORE',
    )
    expect(text).not.toContain('TOP-SECRET-VALUE')
  })

  it('refuses an unknown preset and an unknown addressing', () => {
    expect(message({ type: 's3', preset: 'dropbox', addressing: 'sideways' }, environment)).toBe(
      'IMAGE_STORE (s3): "preset" must be one of aws, r2, hetzner, b2, wasabi, spaces, minio, custom; "addressing" must be path or virtual',
    )
  })

  it('adds where the problem is to what the preset itself refuses', () => {
    expect(message({ type: 's3', preset: 'b2' }, environment)).toBe('IMAGE_STORE (s3): the "b2" preset needs a region')
  })
})

describe('createBlobStoreFromSpec: gcs', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const credentials = JSON.stringify({
    client_email: 'a@b',
    private_key: privateKey,
    token_uri: 'https://token.example.test/t',
  })

  it('builds a store from key text in the environment, and signs in before the first request', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      'gcs',
      context({ IMAGE_STORE_GCS_BUCKET: 'b', IMAGE_STORE_GCS_CREDENTIALS_JSON: credentials }, { fetch }),
    )

    await store.stat(SHA).catch(() => undefined)

    expect(requested[0]).toBe('https://token.example.test/t')
  })

  it('builds a store from a key file, read once at start-up', async () => {
    const readTextFile = vi.fn(() => credentials)
    createBlobStoreFromSpec(
      'gcs',
      context({ IMAGE_STORE_GCS_BUCKET: 'b', IMAGE_STORE_GCS_CREDENTIALS_FILE: '/run/key.json' }, { readTextFile }),
    )

    expect(readTextFile).toHaveBeenCalledWith('/run/key.json')
  })

  it('reads the key file from disk when no reader is given, and says so when it cannot', () => {
    expect(
      message('gcs', { IMAGE_STORE_GCS_BUCKET: 'b', IMAGE_STORE_GCS_CREDENTIALS_FILE: '/nonexistent/key.json' }),
    ).toMatch(/^IMAGE_STORE \(gcs\): the Google Cloud credentials file cannot be read/)
  })

  it('builds an unauthenticated store for an emulator at a named endpoint', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      { type: 'gcs', bucket: 'b', endpoint: 'http://localhost:4443', prefix: 'p/' },
      context({}, { fetch }),
    )

    await store.stat(SHA)

    expect(requested[0]).toMatch(/^http:\/\/localhost:4443\/storage\/v1\/b\/b\/o\/p%2Fsha256/)
  })

  it('needs credentials unless an endpoint is named', () => {
    expect(message('gcs', { IMAGE_STORE_GCS_BUCKET: 'b' })).toBe(
      'IMAGE_STORE (gcs): set IMAGE_STORE_GCS_CREDENTIALS_JSON or IMAGE_STORE_GCS_CREDENTIALS_FILE (or an "endpoint" for an emulator)',
    )
  })

  it('refuses credentials given twice', () => {
    expect(
      message('gcs', {
        IMAGE_STORE_GCS_BUCKET: 'b',
        IMAGE_STORE_GCS_CREDENTIALS_JSON: credentials,
        IMAGE_STORE_GCS_CREDENTIALS_FILE: '/x',
      }),
    ).toMatch(/give the credentials once/)
  })

  it('refuses key text that is not a service-account key', () => {
    expect(message('gcs', { IMAGE_STORE_GCS_BUCKET: 'b', IMAGE_STORE_GCS_CREDENTIALS_JSON: '{}' })).toBe(
      'IMAGE_STORE (gcs): the Google Cloud credentials need "client_email" and "private_key"',
    )
  })
})

describe('createBlobStoreFromSpec: azure', () => {
  const base = { IMAGE_STORE_AZURE_ACCOUNT: 'acct', IMAGE_STORE_AZURE_CONTAINER: 'blobs' }

  it('builds a Shared Key store at the account address', async () => {
    const { fetch, requested } = recordingFetch()
    const key = Buffer.alloc(32).toString('base64')
    const store = createBlobStoreFromSpec('azure', context({ ...base, IMAGE_STORE_AZURE_ACCOUNT_KEY: key }, { fetch }))

    await store.stat(SHA)

    expect(requested[0]).toMatch(/^https:\/\/acct\.blob\.core\.windows\.net\/blobs\/sha256\//)
  })

  it('builds a SAS store at a named endpoint, with a key prefix', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      { type: 'azure', endpoint: 'http://127.0.0.1:10000/devstoreaccount1', prefix: 'p/' },
      context({ ...base, IMAGE_STORE_AZURE_SAS_TOKEN: 'sv=1&sig=2' }, { fetch }),
    )

    await store.stat(SHA)

    expect(requested[0]).toContain('/devstoreaccount1/blobs/p/sha256/')
    expect(requested[0]).toContain('sv=1&sig=2')
  })

  it.each([
    ['neither', {}],
    ['both', { IMAGE_STORE_AZURE_ACCOUNT_KEY: 'a', IMAGE_STORE_AZURE_SAS_TOKEN: 'b' }],
  ])('refuses %s of an account key and a SAS token', (_label, secrets) => {
    expect(message('azure', { ...base, ...secrets })).toBe(
      'IMAGE_STORE (azure): set exactly one of IMAGE_STORE_AZURE_ACCOUNT_KEY and IMAGE_STORE_AZURE_SAS_TOKEN',
    )
  })

  it('names the account and container when they are missing', () => {
    expect(message('azure', { IMAGE_STORE_AZURE_SAS_TOKEN: 's' })).toBe(
      'IMAGE_STORE (azure): set IMAGE_STORE_AZURE_ACCOUNT (or "account" in IMAGE_STORE); set IMAGE_STORE_AZURE_CONTAINER (or "container" in IMAGE_STORE)',
    )
  })
})

describe('createBlobStoreFromSpec: ipfs', () => {
  it('builds a store on a local Kubo node, which needs an address and gateways but no token', async () => {
    const index = createMemoryCidIndex()
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      'ipfs',
      context(
        {
          IMAGE_STORE_IPFS_PROVIDER: 'kubo',
          IMAGE_STORE_IPFS_API_URL: 'http://127.0.0.1:5001',
          IMAGE_STORE_IPFS_GATEWAYS: 'http://127.0.0.1:8080/ipfs/, http://other.example.test/ipfs/',
        },
        { fetch, createCidIndex: () => index },
      ),
    )

    await store.put(Buffer.from('x')).catch(() => undefined)

    expect(requested[0]).toMatch(/^http:\/\/127\.0\.0\.1:5001\/api\/v0\/add\?/)
  })

  it.each(['filebase', 'pinata'])('builds a %s store from its token alone, using the provider defaults', (provider) => {
    expect(() =>
      createBlobStoreFromSpec(
        { type: 'ipfs', provider },
        context({ IMAGE_STORE_IPFS_API_TOKEN: 't' }, { createCidIndex: () => createMemoryCidIndex() }),
      ),
    ).not.toThrow()
  })

  it('uses the database index when none is supplied, without touching the database yet', () => {
    expect(() =>
      createBlobStoreFromSpec({ type: 'ipfs', provider: 'pinata' }, context({ IMAGE_STORE_IPFS_API_TOKEN: 't' })),
    ).not.toThrow()
  })

  it('needs a token for a hosted provider', () => {
    expect(message({ type: 'ipfs', provider: 'pinata' })).toBe('IMAGE_STORE (ipfs): set IMAGE_STORE_IPFS_API_TOKEN')
  })

  it('needs an address and gateways for a plain Kubo node', () => {
    expect(message({ type: 'ipfs', provider: 'kubo' })).toBe(
      'IMAGE_STORE (ipfs): set IMAGE_STORE_IPFS_API_URL (or "apiUrl"); set IMAGE_STORE_IPFS_GATEWAYS (comma separated, or "gateways")',
    )
  })

  it('refuses an unknown provider, and a missing one', () => {
    expect(message({ type: 'ipfs', provider: 'carrier-pigeon' })).toBe(
      'IMAGE_STORE (ipfs): "provider" must be one of kubo, filebase, pinata',
    )
    expect(message('ipfs')).toBe('IMAGE_STORE (ipfs): set IMAGE_STORE_IPFS_PROVIDER (or "provider" in IMAGE_STORE)')
  })
})

describe('createBlobStoreFromSpec: composites', () => {
  it('builds a tiered store from a JSON spec, with a size written as text', async () => {
    const cache = await temporaryDirectory()
    const backing = await temporaryDirectory()
    const store = createBlobStoreFromSpec(
      JSON.stringify({
        type: 'tiered',
        maxBytes: '1MiB',
        cache: { type: 'local', dir: cache },
        backing: { type: 'local', dir: backing },
      }),
      context(),
    )

    const { sha256 } = await store.put(Buffer.from('tiered'))

    expect(await fileSystem.readdir(path.join(cache, 'sha256'))).toHaveLength(1)
    expect(await store.get(sha256)).toEqual(Buffer.from('tiered'))
  })

  it('builds a mirror of kind names and objects', async () => {
    const first = await temporaryDirectory()
    const second = await temporaryDirectory()
    const store = createBlobStoreFromSpec(
      {
        type: 'mirrored',
        minimumWrites: 2,
        stores: [
          { type: 'local', dir: first },
          { type: 'local', dir: second },
        ],
      },
      context(),
    )

    await store.put(Buffer.from('mirrored'))

    expect(await fileSystem.readdir(path.join(first, 'sha256'))).toHaveLength(1)
    expect(await fileSystem.readdir(path.join(second, 'sha256'))).toHaveLength(1)
  })

  it('builds a fallback of a local primary and a second store', async () => {
    const primary = await temporaryDirectory()
    const shared = await temporaryDirectory()
    const store = createBlobStoreFromSpec(
      { type: 'fallback', primary: { type: 'local', dir: primary }, fallback: { type: 'local', dir: shared } },
      context(),
    )

    await store.put(Buffer.from('mine'))

    expect(await fileSystem.readdir(path.join(shared)).catch(() => [])).toEqual([])
  })

  it('says where in the spec a nested problem is', () => {
    expect(
      message(
        { type: 'tiered', maxBytes: 100, cache: 'local', backing: { type: 's3', preset: 'minio' } },
        { IMAGE_STORE_S3_BUCKET: 'b', IMAGE_STORE_S3_ACCESS_KEY_ID: 'i', IMAGE_STORE_S3_SECRET_ACCESS_KEY: 's' },
      ),
    ).toBe('IMAGE_STORE.backing (s3): the "minio" preset needs an endpoint')
    expect(message({ type: 'mirrored', stores: ['local', { type: 'nope' }] })).toBe(
      'IMAGE_STORE.stores[1]: unknown store type "nope"; use one of local, s3, gcs, azure, ipfs, tiered, mirrored, fallback',
    )
    expect(message({ type: 'fallback', primary: 'local', fallback: 's3' })).toMatch(
      /^IMAGE_STORE\.fallback \(s3\): set IMAGE_STORE_S3_BUCKET/,
    )
  })

  it('gives a second store of one kind its own environment prefix', async () => {
    const { fetch, requested } = recordingFetch()
    const store = createBlobStoreFromSpec(
      {
        type: 'mirrored',
        stores: [
          { type: 's3', envPrefix: 'FIRST_' },
          { type: 's3', envPrefix: 'SECOND_' },
        ],
      },
      context(
        {
          FIRST_BUCKET: 'first-bucket',
          FIRST_ACCESS_KEY_ID: 'i',
          FIRST_SECRET_ACCESS_KEY: 's',
          SECOND_BUCKET: 'second-bucket',
          SECOND_ACCESS_KEY_ID: 'i',
          SECOND_SECRET_ACCESS_KEY: 's',
        },
        { fetch },
      ),
    )

    await store.stat(SHA)

    expect(requested.map((address) => new URL(address).host)).toEqual([
      'first-bucket.s3.us-east-1.amazonaws.com',
      'second-bucket.s3.us-east-1.amazonaws.com',
    ])
  })

  it.each([
    [
      'a tiered store with nothing',
      { type: 'tiered' },
      'IMAGE_STORE (tiered): "maxBytes" must be a whole number of bytes or text such as 5GiB; "cache" is missing; "backing" is missing',
    ],
    [
      'a mirror with no stores',
      { type: 'mirrored', stores: [] },
      'IMAGE_STORE (mirrored): "stores" must be a list of at least one store',
    ],
    [
      'a mirror with a fractional minimum',
      { type: 'mirrored', stores: ['local'], minimumWrites: 1.5 },
      'IMAGE_STORE (mirrored): "minimumWrites" must be a whole number',
    ],
    [
      'a fallback with nothing',
      { type: 'fallback' },
      'IMAGE_STORE (fallback): "primary" is missing; "fallback" is missing',
    ],
    [
      'a member that is a number',
      { type: 'mirrored', stores: [7] },
      'IMAGE_STORE.stores[0]: expected a kind name or an object with a "type"',
    ],
    [
      'a member with no type',
      { type: 'fallback', primary: {}, fallback: 'local' },
      'IMAGE_STORE.primary: the "type" is missing',
    ],
  ])('refuses %s', (_label, spec, expected) => {
    expect(message(spec)).toBe(expected)
  })

  it('lets an error that is not a configuration error through unchanged', () => {
    const broken = () => {
      throw new TypeError('database is gone')
    }

    expect(() =>
      createBlobStoreFromSpec(
        { type: 'ipfs', provider: 'pinata' },
        context({ IMAGE_STORE_IPFS_API_TOKEN: 't' }, { createCidIndex: broken }),
      ),
    ).toThrow(TypeError)
  })
})
