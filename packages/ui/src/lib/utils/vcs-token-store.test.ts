/**
 * The store that holds access tokens for the version control hosts.
 *
 * Every test supplies its own clock and its own storage. That is the point of
 * the module: an expiry measured against the wall clock can only be tested by
 * waiting thirty days or by stubbing a global, and a credential store whose
 * expiry nobody has checked is a credential store with no expiry.
 */
import { describe, it, expect } from 'vitest'
import { createTokenStore, TOKEN_STORAGE_KEY, TOKEN_MAX_AGE_MS } from './vcs-token-store'

/** A storage that keeps what it is given, so a test can read it back. */
const memoryStorage = (initial: Record<string, string> = {}) => {
  const held = { ...initial }
  return {
    getItem: (key: string) => held[key] ?? null,
    setItem: (key: string, value: string) => {
      held[key] = value
    },
    raw: () => held,
  }
}

/** A clock the test moves by hand. */
const clockAt = (start = 1_000_000) => {
  let value = start
  return { now: () => value, advance: (ms: number) => (value += ms) }
}

describe('createTokenStore', () => {
  it('reads back a token it just wrote', () => {
    const store = createTokenStore({ storage: memoryStorage(), now: clockAt().now })
    store.write('github', 'ghp_fresh')
    expect(store.read('github')).toBe('ghp_fresh')
  })

  it("keeps each provider apart, so one host cannot publish with another's token", () => {
    const store = createTokenStore({ storage: memoryStorage(), now: clockAt().now })
    store.write('github', 'ghp_one')
    store.write('gitlab', 'glpat_two')
    expect(store.read('github')).toBe('ghp_one')
    expect(store.read('gitlab')).toBe('glpat_two')
  })

  it('returns null for a provider that has never been authorized', () => {
    const store = createTokenStore({ storage: memoryStorage(), now: clockAt().now })
    expect(store.read('gitea')).toBeNull()
  })

  it('still serves a token one millisecond before the window closes', () => {
    // The boundary is the claim. An off-by-one here logs every user out a day
    // early, or keeps a credential alive a day too long.
    const clock = clockAt()
    const store = createTokenStore({ storage: memoryStorage(), now: clock.now })
    store.write('github', 'ghp_edge')
    clock.advance(TOKEN_MAX_AGE_MS)
    expect(store.read('github')).toBe('ghp_edge')
  })

  it('refuses a token once the window has passed', () => {
    const clock = clockAt()
    const store = createTokenStore({ storage: memoryStorage(), now: clock.now })
    store.write('github', 'ghp_old')
    clock.advance(TOKEN_MAX_AGE_MS + 1)
    expect(store.read('github')).toBeNull()
  })

  it('deletes an expired token rather than leaving it to be read again', () => {
    // Returning null while the token sits in the profile is not expiry, it is a
    // filter. Anything that reads the storage directly would still find it.
    const storage = memoryStorage()
    const clock = clockAt()
    const store = createTokenStore({ storage, now: clock.now })
    store.write('github', 'ghp_old')
    clock.advance(TOKEN_MAX_AGE_MS + 1)
    store.read('github')
    expect(storage.raw()[TOKEN_STORAGE_KEY]).not.toContain('ghp_old')
  })

  it('expiring one provider leaves the others alone', () => {
    const clock = clockAt()
    const store = createTokenStore({ storage: memoryStorage(), now: clock.now })
    store.write('github', 'ghp_old')
    clock.advance(TOKEN_MAX_AGE_MS + 1)
    store.write('gitlab', 'glpat_new')
    expect(store.read('github')).toBeNull()
    expect(store.read('gitlab')).toBe('glpat_new')
  })

  it('treats an entry with no timestamp as expired and removes it', () => {
    // Older builds wrote a bare string. Such an entry cannot be shown to be
    // inside the window, and a credential that cannot be shown to be current is
    // not current. Trusting it because it is old is how the tokens that have sat
    // in a profile longest become the only ones that never expire.
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: JSON.stringify({ github: 'ghp_legacy' }) })
    const store = createTokenStore({ storage, now: clockAt().now })
    expect(store.read('github')).toBeNull()
    expect(storage.raw()[TOKEN_STORAGE_KEY]).not.toContain('ghp_legacy')
  })

  it('stamps a written token with the clock it was given, not the wall clock', () => {
    const storage = memoryStorage()
    const store = createTokenStore({ storage, now: () => 42 })
    store.write('github', 'ghp_stamped')
    expect(JSON.parse(storage.raw()[TOKEN_STORAGE_KEY]).github.storedAt).toBe(42)
  })

  it('forgets a token on request', () => {
    const store = createTokenStore({ storage: memoryStorage(), now: clockAt().now })
    store.write('github', 'ghp_signout')
    store.clear('github')
    expect(store.read('github')).toBeNull()
  })

  it('survives unreadable storage rather than blocking a publish', () => {
    // A profile can hold anything under this key. Throwing here would stop a
    // user publishing at all, when authorizing again would have fixed it.
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: 'not json at all' })
    const store = createTokenStore({ storage, now: clockAt().now })
    expect(store.read('github')).toBeNull()
    expect(() => store.write('github', 'ghp_new')).not.toThrow()
    expect(store.read('github')).toBe('ghp_new')
  })

  it('replaces a stored value that is not an object of providers', () => {
    // An array under this key reads as empty either way, so reading it is not
    // the claim. Writing is: setting a named property on an array and then
    // serializing it drops the property, so the token would be accepted, lost,
    // and the user left wondering why they must authorize on every publish.
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: JSON.stringify(['github']) })
    const store = createTokenStore({ storage, now: clockAt().now })
    expect(store.read('github')).toBeNull()

    store.write('github', 'ghp_after')
    expect(store.read('github')).toBe('ghp_after')
  })

  it('does not throw when storage refuses to accept a write', () => {
    // A full or blocked store costs the user one more authorization later. It
    // must not throw out of a publish that has already succeeded.
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const store = createTokenStore({ storage, now: clockAt().now })
    expect(() => store.write('github', 'ghp_new')).not.toThrow()
  })
})
