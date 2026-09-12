/**
 * Where access tokens for the version control hosts are kept.
 *
 * These are credentials. A token here publishes a token list to somebody's
 * repository under their name, so how long one survives in a browser profile is
 * a security property, not a convenience setting. That is the reason this is a
 * module of its own with a clock it is given: an expiry nothing can test is an
 * expiry nobody should trust.
 */

/** Reads the current time in milliseconds. */
export type Clock = () => number

/** The part of the Storage interface this needs. */
export interface TokenStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** Where the tokens live. */
export const TOKEN_STORAGE_KEY = 'gib-vcs-tokens'

/** How long a stored token stays usable: thirty days. */
export const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** A token and when it was written. */
interface StoredToken {
  token: string
  storedAt: number
}

/**
 * Anything that has ever been written under a provider name.
 *
 * Older builds wrote a bare string with no timestamp. Those entries still sit
 * in browser profiles, so the type has to admit them.
 */
type StoredEntry = StoredToken | string

export interface TokenStoreOptions {
  storage?: TokenStorage
  now?: Clock
}

export interface TokenStore {
  /** The usable token for a provider, or null. Removes one that has expired. */
  read: (provider: string) => string | null
  /** Record a token against a provider, stamped with the current time. */
  write: (provider: string, token: string) => void
  /** Forget a provider's token. */
  clear: (provider: string) => void
}

const isStoredToken = (entry: StoredEntry): entry is StoredToken =>
  typeof entry === 'object' && entry !== null && typeof entry.token === 'string'

/**
 * Build a token store.
 *
 * @param options.storage - Where to keep the tokens. Defaults to `localStorage`.
 * @param options.now - The clock. Defaults to the wall clock. A test supplies
 *   its own so it can state that thirty-one days passed.
 */
export const createTokenStore = (options: TokenStoreOptions = {}): TokenStore => {
  const { storage = localStorage, now = () => Date.now() } = options

  const readAll = (): Record<string, StoredEntry> => {
    try {
      const parsed = JSON.parse(storage.getItem(TOKEN_STORAGE_KEY) || '{}')
      // A value that is not an object cannot be indexed by provider. Anything
      // stored under this key that does not have that shape is not ours.
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
      return parsed as Record<string, StoredEntry>
    } catch {
      // Unreadable storage must not stop a user publishing; they authorize again.
      return {}
    }
  }

  const writeAll = (entries: Record<string, StoredEntry>): void => {
    try {
      storage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // A full or blocked store costs the user a re-authorization later. It must
      // not throw out of a publish that has otherwise succeeded.
    }
  }

  const clear = (provider: string): void => {
    const entries = readAll()
    delete entries[provider]
    writeAll(entries)
  }

  const read = (provider: string): string | null => {
    const entry = readAll()[provider]
    if (entry === undefined) return null

    // An entry with no timestamp cannot be shown to be inside the window, and a
    // credential that cannot be shown to be current is treated as expired. The
    // alternative reading — trust it because it is old — is how a token written
    // before the expiry existed goes on working forever, which is the one thing
    // the expiry is for. Stamping it with the present time instead would be
    // worse still: it would launder an old token into a fresh-looking one.
    if (!isStoredToken(entry)) {
      clear(provider)
      return null
    }

    if (now() - entry.storedAt > TOKEN_MAX_AGE_MS) {
      clear(provider)
      return null
    }
    return entry.token
  }

  const write = (provider: string, token: string): void => {
    const entries = readAll()
    entries[provider] = { token, storedAt: now() }
    writeAll(entries)
  }

  return { read, write, clear }
}
