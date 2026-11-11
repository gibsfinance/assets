/**
 * @module image-store/store-config
 * Builds a blob store from configuration: which kind, and every setting it needs.
 *
 * **Choosing.** `IMAGE_STORE` is a kind name (`local`, `s3`, `gcs`, `azure`, `ipfs`) or a JSON
 * object for a composite (`tiered`, `mirrored`, `fallback`) or for one kind with settings:
 *
 *     IMAGE_STORE=s3
 *     IMAGE_STORE='{"type":"tiered","maxBytes":"5GiB","cache":{"type":"local","dir":"/var/cache/images"},"backing":"s3"}'
 *     IMAGE_STORE='{"type":"mirrored","stores":["s3",{"type":"gcs","envPrefix":"IMAGE_STORE_BACKUP_GCS_"}]}'
 *     IMAGE_STORE='{"type":"fallback","primary":"local","fallback":{"type":"s3","envPrefix":"IMAGE_STORE_SHARED_S3_"}}'
 *
 * **Settings.** A setting that is not a secret may be written in the JSON object (`"bucket"`) or
 * set in the environment; the environment name is the setting's name in capitals with the store's
 * prefix, `IMAGE_STORE_<KIND>_` (`IMAGE_STORE_S3_BUCKET`). The JSON value wins. A secret (an
 * access key, an account key, a token, a key file's contents) is read from the environment
 * only: writing one in the JSON is refused, so a secret cannot end up in a file that gets
 * committed or in a log of the configuration. When two stores of one kind are in use, give the
 * second its own prefix with `"envPrefix"`.
 *
 * **Failing early.** Every mistake (unknown kind, unknown setting, missing or invalid value, a
 * secret in the wrong place) throws an {@link ImageStoreConfigurationError} that names the
 * setting, and `initializeImageStore` turns that into one clear line at start-up. No message
 * contains a secret's value.
 */
import * as fileSystem from 'node:fs'
import * as path from 'node:path'
import { log } from '../logger'
import { createAzureBlobStore } from './azure'
import { createDatabaseCidIndex, type BlobCidIndex } from './cid-index'
import { createFallbackBlobStore, createMirroredBlobStore, createTieredBlobStore } from './composite'
import { ImageStoreConfigurationError } from './configuration-error'
import { createGcsBlobStore, parseGcsCredentials, type GcsServiceAccount } from './gcs'
import type { RemoteStoreEnvironment } from './http'
import {
  createIpfsBlobStore,
  createPinningClient,
  IPFS_PROVIDER_NAMES,
  IPFS_PROVIDERS,
  type IpfsProviderName,
} from './ipfs'
import { createLocalBlobStore } from './local'
import { createS3BlobStore, resolveS3Location, S3_PRESET_NAMES, type S3Addressing, type S3PresetName } from './s3'
import type { BlobStore } from './types'

/** A store's settings as written in the JSON: its kind, plus whatever that kind reads. */
export type StoreSpec = { type: string; [setting: string]: unknown }

/** Everything the builder needs from outside, so tests can supply fakes. */
export type StoreBuildContext = RemoteStoreEnvironment & {
  /** Where settings and secrets are read from. Defaults to `process.env`. */
  environment?: Readonly<Record<string, string | undefined>>
  /** The directory a local store uses when none is named. */
  defaultLocalDirectory: string
  /** Reads a text file, for the Google Cloud key file. Defaults to `node:fs`. */
  readTextFile?: (filePath: string) => string
  /** Builds the digest-to-CID index the IPFS store needs. Defaults to the database table. */
  createCidIndex?: () => BlobCidIndex
}

/** The kinds that name one store. */
export const SIMPLE_STORE_KINDS = ['local', 's3', 'gcs', 'azure', 'ipfs'] as const

/** The kinds that combine other stores. */
export const COMPOSITE_STORE_KINDS = ['tiered', 'mirrored', 'fallback'] as const

const ALL_KINDS: readonly string[] = [...SIMPLE_STORE_KINDS, ...COMPOSITE_STORE_KINDS]

const BYTE_UNITS: Readonly<Record<string, number>> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }

/**
 * Reads a size in bytes from a number or from text such as `5GiB`.
 *
 * @param value A whole number of bytes, or text of a whole number followed by `B`, `KiB`, `MiB`, `GiB` or `TiB`.
 * @returns The size in bytes, or null when the value is not a size.
 */
export function parseByteSize(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const match = /^\s*(\d+)\s*(B|KiB|MiB|GiB|TiB)?\s*$/.exec(value)
  if (!match) return null
  const bytes = Number(match[1]) * BYTE_UNITS[match[2] ?? 'B']
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null
}

/**
 * Reads the text of the `IMAGE_STORE` setting.
 *
 * @param text A kind name, or JSON starting with `{`.
 * @returns The spec.
 * @throws ImageStoreConfigurationError when JSON does not parse or is not an object with a kind.
 */
export function parseStoreSpecText(text: string): StoreSpec {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { type: trimmed }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new ImageStoreConfigurationError(`IMAGE_STORE is not valid JSON: ${(error as Error).message}`)
  }
  return asSpec(parsed, 'IMAGE_STORE')
}

/** Turns a kind name or an object, as found inside a composite, into a spec. */
function asSpec(value: unknown, where: string): StoreSpec {
  if (typeof value === 'string') return { type: value.trim() }
  const isSpec = typeof value === 'object' && value !== null && !Array.isArray(value)
  if (!isSpec) throw new ImageStoreConfigurationError(`${where}: expected a kind name or an object with a "type"`)
  const spec = value as Record<string, unknown>
  if (typeof spec.type !== 'string') throw new ImageStoreConfigurationError(`${where}: the "type" is missing`)
  return spec as StoreSpec
}

/** `accessKeyId` becomes `ACCESS_KEY_ID`. */
const environmentSuffix = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()

/** What a store reads from its spec and the environment, and what it found wrong. */
type SettingsReader = {
  /** A setting that is not a secret: the spec first, then the environment. */
  text: (key: string, options?: { required?: boolean }) => string | undefined
  /** A secret: the environment only. A value in the spec is a problem. */
  secret: (key: string, options?: { required?: boolean }) => string | undefined
  /** The raw value of a setting that is not text, such as a nested spec or a number. */
  raw: (key: string) => unknown
  /** The environment variable a setting is read from. */
  nameOf: (key: string) => string
  /** Records a problem with one setting. */
  problem: (message: string) => void
  /** Throws for everything found wrong, including settings nothing read. */
  finish: () => void
}

const createSettingsReader = (spec: StoreSpec, context: StoreBuildContext, where: string): SettingsReader => {
  const environment = context.environment ?? process.env
  const prefix =
    typeof spec.envPrefix === 'string'
      ? spec.envPrefix
      : spec.type === 'local'
        ? 'IMAGE_STORE_'
        : `IMAGE_STORE_${spec.type.toUpperCase()}_`
  const used = new Set(['type', 'envPrefix'])
  const problems: string[] = []
  const nameOf = (key: string): string => `${prefix}${environmentSuffix(key)}`
  const fromEnvironment = (key: string): string | undefined => environment[nameOf(key)]?.trim() || undefined

  const text: SettingsReader['text'] = (key, options = {}) => {
    used.add(key)
    const written = spec[key]
    if (typeof written === 'string' && written.trim()) return written.trim()
    if (written !== undefined) problems.push(`"${key}" must be text`)
    const found = fromEnvironment(key)
    if (found === undefined && options.required) problems.push(`set ${nameOf(key)} (or "${key}" in IMAGE_STORE)`)
    return found
  }

  const secret: SettingsReader['secret'] = (key, options = {}) => {
    used.add(key)
    if (spec[key] !== undefined)
      problems.push(`"${key}" is a secret: set ${nameOf(key)} in the environment, not in IMAGE_STORE`)
    const found = fromEnvironment(key)
    if (found === undefined && options.required) problems.push(`set ${nameOf(key)}`)
    return found
  }

  return {
    text,
    secret,
    raw: (key) => {
      used.add(key)
      return spec[key]
    },
    nameOf,
    problem: (message) => {
      problems.push(message)
    },
    finish: () => {
      for (const key of Object.keys(spec).filter((name) => !used.has(name))) problems.push(`unknown setting "${key}"`)
      if (problems.length > 0) throw new ImageStoreConfigurationError(`${where} (${spec.type}): ${problems.join('; ')}`)
    },
  }
}

/** The settings every remote store takes besides its own: the network, clock and key prefix. */
const remoteEnvironment = (context: StoreBuildContext): RemoteStoreEnvironment => ({
  fetch: context.fetch,
  now: context.now,
  retries: context.retries,
  sleep: context.sleep,
})

type Builder = (spec: StoreSpec, context: StoreBuildContext, where: string) => BlobStore

const buildLocal: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const directory = read.text('dir') ?? context.defaultLocalDirectory
  read.finish()
  const store = createLocalBlobStore({ root: path.resolve(directory) })
  store.sweepStaleTemporaryFiles().then(
    (deleted) => deleted > 0 && log('image store: swept %d stale temporary files', deleted),
    (error: unknown) => log('image store: temporary file sweep failed: %o', error),
  )
  return store
}

const isOneOf = <Value extends string>(value: string, allowed: readonly Value[]): value is Value =>
  (allowed as readonly string[]).includes(value)

const buildS3: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const preset = read.text('preset') ?? 'aws'
  const bucket = read.text('bucket', { required: true })
  const region = read.text('region')
  const endpoint = read.text('endpoint')
  const accountId = read.text('accountId')
  const addressing = read.text('addressing')
  const keyPrefix = read.text('prefix')
  const accessKeyId = read.secret('accessKeyId', { required: true })
  const secretAccessKey = read.secret('secretAccessKey', { required: true })
  const sessionToken = read.secret('sessionToken')
  if (!isOneOf(preset, S3_PRESET_NAMES)) read.problem(`"preset" must be one of ${S3_PRESET_NAMES.join(', ')}`)
  if (addressing !== undefined && !isOneOf(addressing, ['path', 'virtual'] as const)) {
    read.problem('"addressing" must be path or virtual')
  }
  read.finish()
  const location = resolveS3Location({
    preset: preset as S3PresetName,
    region,
    endpoint,
    accountId,
    addressing: addressing as S3Addressing | undefined,
  })
  return createS3BlobStore({
    ...remoteEnvironment(context),
    location,
    bucket: bucket as string,
    credentials: { accessKeyId: accessKeyId as string, secretAccessKey: secretAccessKey as string, sessionToken },
    keyPrefix,
  })
}

const buildGcs: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const bucket = read.text('bucket', { required: true })
  const endpoint = read.text('endpoint')
  const keyPrefix = read.text('prefix')
  const credentialsFile = read.text('credentialsFile')
  const credentialsJson = read.secret('credentialsJson')
  const hasCredentials = credentialsFile !== undefined || credentialsJson !== undefined
  if (credentialsFile !== undefined && credentialsJson !== undefined) {
    read.problem('give the credentials once: either credentialsFile or credentialsJson')
  }
  if (!hasCredentials && endpoint === undefined) {
    read.problem(
      `set ${read.nameOf('credentialsJson')} or ${read.nameOf('credentialsFile')} (or an "endpoint" for an emulator)`,
    )
  }
  read.finish()
  const readTextFile = context.readTextFile ?? ((filePath: string) => fileSystem.readFileSync(filePath, 'utf8'))
  let credentials: GcsServiceAccount | undefined
  if (hasCredentials) {
    credentials = parseGcsCredentials(credentialsJson ?? readCredentialsFile(readTextFile, credentialsFile as string))
  }
  return createGcsBlobStore({
    ...remoteEnvironment(context),
    bucket: bucket as string,
    endpoint,
    credentials,
    keyPrefix,
  })
}

const readCredentialsFile = (readTextFile: (filePath: string) => string, filePath: string): string => {
  try {
    return readTextFile(filePath)
  } catch (error) {
    throw new ImageStoreConfigurationError(
      `the Google Cloud credentials file cannot be read: ${(error as Error).message}`,
    )
  }
}

const buildAzure: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const accountName = read.text('account', { required: true })
  const containerName = read.text('container', { required: true })
  const endpoint = read.text('endpoint')
  const keyPrefix = read.text('prefix')
  const accountKey = read.secret('accountKey')
  const sasToken = read.secret('sasToken')
  if ((accountKey === undefined) === (sasToken === undefined)) {
    read.problem(`set exactly one of ${read.nameOf('accountKey')} and ${read.nameOf('sasToken')}`)
  }
  read.finish()
  return createAzureBlobStore({
    ...remoteEnvironment(context),
    accountName: accountName as string,
    containerName: containerName as string,
    accountKey,
    sasToken,
    endpoint,
    keyPrefix,
  })
}

const buildIpfs: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const provider = read.text('provider', { required: true })
  const apiUrl = read.text('apiUrl')
  const gatewayText = read.text('gateways')
  const token = read.secret('apiToken')
  const known = provider !== undefined && isOneOf(provider, IPFS_PROVIDER_NAMES)
  if (provider !== undefined && !known) read.problem(`"provider" must be one of ${IPFS_PROVIDER_NAMES.join(', ')}`)
  const preset = known ? IPFS_PROVIDERS[provider as IpfsProviderName] : undefined
  const resolvedApiUrl = apiUrl ?? preset?.defaultApiUrl ?? undefined
  const gateways = gatewayText
    ?.split(',')
    .map((gateway) => gateway.trim())
    .filter(Boolean) ?? [...(preset?.defaultGateways ?? [])]
  if (preset && !resolvedApiUrl) read.problem(`set ${read.nameOf('apiUrl')} (or "apiUrl")`)
  if (preset && gateways.length === 0) read.problem(`set ${read.nameOf('gateways')} (comma separated, or "gateways")`)
  if (preset?.defaultApiUrl && !token) read.problem(`set ${read.nameOf('apiToken')}`)
  read.finish()
  const environment = remoteEnvironment(context)
  return createIpfsBlobStore({
    ...environment,
    gateways,
    index: (context.createCidIndex ?? createDatabaseCidIndex)(),
    pinning: createPinningClient({
      ...environment,
      flavor: (preset as NonNullable<typeof preset>).flavor,
      apiUrl: resolvedApiUrl as string,
      token,
    }),
  })
}

const buildTiered: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const maxBytes = parseByteSize(read.raw('maxBytes'))
  const cache = read.raw('cache')
  const backing = read.raw('backing')
  if (maxBytes === null) read.problem('"maxBytes" must be a whole number of bytes or text such as 5GiB')
  if (cache === undefined) read.problem('"cache" is missing')
  if (backing === undefined) read.problem('"backing" is missing')
  read.finish()
  return createTieredBlobStore({
    maxCacheBytes: maxBytes as number,
    cache: buildStore(asSpec(cache, `${where}.cache`), context, `${where}.cache`),
    backing: buildStore(asSpec(backing, `${where}.backing`), context, `${where}.backing`),
  })
}

const buildMirrored: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const members = read.raw('stores')
  const minimumWrites = read.raw('minimumWrites')
  if (!Array.isArray(members) || members.length === 0) read.problem('"stores" must be a list of at least one store')
  if (minimumWrites !== undefined && !Number.isInteger(minimumWrites))
    read.problem('"minimumWrites" must be a whole number')
  read.finish()
  const stores = (members as unknown[]).map((member, index) =>
    buildStore(asSpec(member, `${where}.stores[${index}]`), context, `${where}.stores[${index}]`),
  )
  return createMirroredBlobStore({ stores, minimumWrites: minimumWrites as number | undefined })
}

const buildFallback: Builder = (spec, context, where) => {
  const read = createSettingsReader(spec, context, where)
  const primary = read.raw('primary')
  const fallback = read.raw('fallback')
  if (primary === undefined) read.problem('"primary" is missing')
  if (fallback === undefined) read.problem('"fallback" is missing')
  read.finish()
  return createFallbackBlobStore({
    primary: buildStore(asSpec(primary, `${where}.primary`), context, `${where}.primary`),
    fallback: buildStore(asSpec(fallback, `${where}.fallback`), context, `${where}.fallback`),
  })
}

const BUILDERS: Readonly<Record<string, Builder>> = {
  local: buildLocal,
  s3: buildS3,
  gcs: buildGcs,
  azure: buildAzure,
  ipfs: buildIpfs,
  tiered: buildTiered,
  mirrored: buildMirrored,
  fallback: buildFallback,
}

/** Builds a store from a spec, and prefixes any configuration error with where in the spec it arose. */
function buildStore(spec: StoreSpec, context: StoreBuildContext, where: string): BlobStore {
  const build = isOneOf(spec.type, ALL_KINDS) ? BUILDERS[spec.type] : undefined
  if (!build) {
    throw new ImageStoreConfigurationError(
      `${where}: unknown store type "${spec.type}"; use one of ${ALL_KINDS.join(', ')}`,
    )
  }
  try {
    return build(spec, context, where)
  } catch (error) {
    if (!(error instanceof ImageStoreConfigurationError)) throw error
    if (error.message.startsWith(where)) throw error
    throw new ImageStoreConfigurationError(`${where} (${spec.type}): ${error.message}`)
  }
}

/**
 * Builds the store a configuration describes.
 *
 * @param spec The store's kind and settings. A bare string is a kind name.
 * @param context See {@link StoreBuildContext}.
 * @returns The store.
 * @throws ImageStoreConfigurationError naming each setting that is missing or wrong.
 */
export function createBlobStoreFromSpec(spec: StoreSpec | string, context: StoreBuildContext): BlobStore {
  return buildStore(typeof spec === 'string' ? parseStoreSpecText(spec) : spec, context, 'IMAGE_STORE')
}
