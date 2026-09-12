/**
 * Test setup for the jsdom suite.
 *
 * Node 26 ships its own `localStorage` global, gated behind the
 * `--localstorage-file` command line flag. When the flag is absent Node leaves
 * the global undefined AND suppresses the one jsdom would otherwise install, so
 * every test that touches storage dies with "Cannot read properties of undefined
 * (reading 'clear')". Node 24, which continuous integration runs, has no such
 * built-in and jsdom's storage works — which is why this only ever broke on a
 * developer machine running a newer Node than the pinned one.
 *
 * Rather than pin harder, this file makes the suite indifferent to the Node
 * version: when the runtime failed to supply working storage, install an
 * in-memory replacement.
 *
 * The replacement deliberately puts its methods on `Storage.prototype` and hands
 * out objects that INHERIT them, instead of the more obvious plain object with
 * its own methods. `StudioContext.test.tsx` and `useRpcMetadata.test.ts` both
 * spy with `vi.spyOn(Storage.prototype, 'setItem')`, and a spy on the prototype
 * only intercepts a call that actually reaches the prototype. An own property
 * would shadow it and those spies would silently observe nothing — passing
 * tests that no longer watch anything.
 *
 * Each storage object gets its own backing map, so `localStorage` and
 * `sessionStorage` stay independent the way the real pair does.
 */
/** Per-instance backing maps, so two storage objects never share entries. */
const backingStores = new WeakMap<object, Map<string, string>>()

/** The backing map for one storage object, created on first use. */
const storeFor = (instance: object): Map<string, string> => {
  const existing = backingStores.get(instance)
  if (existing) return existing
  const created = new Map<string, string>()
  backingStores.set(instance, created)
  return created
}

/**
 * Install the in-memory methods onto the shared `Storage` prototype, so a spy
 * placed on the prototype still sits in the call path.
 *
 * `length` is deliberately NOT among them: jsdom defines it on the prototype as
 * non-configurable, so redefining it throws and would abort this whole install
 * — leaving storage undefined and the repair looking like it had not run. It is
 * given to each instance instead, by `createStorage` below.
 */
const installStorageMethods = (): void => {
  const descriptor = (value: unknown) => ({ value, writable: true, configurable: true, enumerable: false })
  Object.defineProperties(Storage.prototype, {
    getItem: descriptor(function (this: Storage, key: string): string | null {
      return storeFor(this).get(String(key)) ?? null
    }),
    setItem: descriptor(function (this: Storage, key: string, value: string): void {
      storeFor(this).set(String(key), String(value))
    }),
    removeItem: descriptor(function (this: Storage, key: string): void {
      storeFor(this).delete(String(key))
    }),
    clear: descriptor(function (this: Storage): void {
      storeFor(this).clear()
    }),
    key: descriptor(function (this: Storage, index: number): string | null {
      return [...storeFor(this).keys()][index] ?? null
    }),
  })
}

/**
 * One storage object: it inherits the methods from `Storage.prototype` so
 * prototype spies keep working, and owns only `length`, which cannot live on
 * the prototype for the reason given above.
 */
const createStorage = (): Storage => {
  const storage = Object.create(Storage.prototype) as Storage
  Object.defineProperty(storage, 'length', {
    get(): number {
      return storeFor(storage).size
    },
    configurable: true,
  })
  return storage
}

/** Publish one storage object as a global under the given name. */
const defineStorageGlobal = (name: 'localStorage' | 'sessionStorage'): void => {
  Object.defineProperty(globalThis, name, {
    value: createStorage(),
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

// Guarded on the symptom rather than on a version number: where the runtime
// already supplies working storage — continuous integration on Node 24, and the
// browser-mode suite — nothing below runs and nothing changes.
//
// The `Storage` check matters separately from the `localStorage` one. A test
// file that opts into `@vitest-environment node` (ThemeContext.server.test.tsx,
// which renders with no browser globals on purpose) has neither `localStorage`
// nor the `Storage` class jsdom would otherwise supply. Without this guard,
// `installStorageMethods` reaches for `Storage.prototype` and throws
// `ReferenceError: Storage is not defined`, which fails that suite outright
// instead of leaving it with the missing globals it is written to expect.
if (typeof globalThis.localStorage === 'undefined' && typeof Storage !== 'undefined') {
  installStorageMethods()
  // Defined straight onto the global rather than through `vi.stubGlobal`.
  // Twenty test files call `vi.unstubAllGlobals()` in their teardown, which
  // removes every stubbed global — including this one. The storage would then
  // survive exactly one test per file and the next `beforeEach` would fail on
  // `localStorage.clear()` again, which is the symptom this file exists to cure.
  // A plain definition is not part of vitest's stub registry, so teardown leaves
  // it alone. It is configurable, so a test that wants to override storage for
  // itself still can.
  defineStorageGlobal('localStorage')
  defineStorageGlobal('sessionStorage')
}
