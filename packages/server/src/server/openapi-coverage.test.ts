/**
 * Every route the server registers must appear in the OpenAPI definition.
 *
 * The sibling openapi.test.ts checks that the document is internally well
 * formed — tags resolve, examples match their templates, refs exist. It cannot
 * notice an endpoint that was never written down at all, and for a while its
 * only defence was `operations.length >= 18`: a floor that passes no matter how
 * many undocumented routes are added, since adding one only ever moves the
 * count up. That is the gap this file closes.
 *
 * Reading the routes back from Express would be the obvious way to do it and it
 * does not work here. Express 5 discards the mount path once the layer is built,
 * and `packages/server/src/server/image/index.ts` registers with
 * `router.use(path, handler)` rather than `router.get`, which produces layers
 * carrying no `route` at all — a stack walk finds nothing for any image
 * endpoint and reports success. A test that silently checks nothing is worse
 * than no test, so the inventory is read from the source instead.
 *
 * The direction is one-way on purpose: every registration must be documented,
 * but not every documented path must have a registration. Some entries describe
 * a variant of a route rather than a route of their own — the extension form
 * `/image/{chainId}/{address}.{ext}` is served by the plain
 * `/image/:chainId/:address` handler, and documenting it separately is right
 * because callers use it as a distinct URL shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { openapi } from './openapi'

/**
 * Where each router module is mounted. Duplicating the prefixes here would
 * invite drift, so the mounts are checked against routes.ts below rather than
 * trusted — a new `router.use` there fails this file until it is listed.
 */
const MOUNTS = [
  { prefix: '/image', file: 'image/index.ts' },
  { prefix: '/list', file: 'list/index.ts' },
  { prefix: '/networks', file: 'networks/index.ts' },
  { prefix: '/stats', file: 'stats/index.ts' },
  { prefix: '/api/github', file: 'github.ts' },
  { prefix: '/api/lists', file: 'submissions.ts' },
  { prefix: '/api/images', file: 'image-submit.ts' },
] as const

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

const readSource = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

/**
 * Pull `router.<method>('<path>'` call sites out of a module.
 *
 * Registrations in this codebase are uniformly written with a literal path as
 * the first argument, sometimes on the following line when the handler list is
 * long. Anything built dynamically would slip past — which is what the
 * "registers at least one route" assertion is for: it turns a regex that has
 * stopped matching into a failure rather than a quiet pass.
 */
const REGISTRATION = /router\.(get|post|put|patch|delete|use)\(\s*'([^']+)'/g

const registrationsIn = (source: string): { method: string; path: string }[] =>
  [...source.matchAll(REGISTRATION)].map(([, method, path]) => ({ method, path }))

/**
 * Express 5 marks an optional segment with braces — `/:providerKey{/:listKey}`
 * is one registration answering two URL shapes, and the document describes both.
 * Expand before converting parameters, while the braces still mean "optional"
 * rather than "parameter".
 */
const expandOptionalSegments = (path: string): string[] => {
  const match = /\{([^}]*)\}/.exec(path)
  if (!match) return [path]
  const [group, inner] = match
  return [...expandOptionalSegments(path.replace(group, '')), ...expandOptionalSegments(path.replace(group, inner))]
}

/** `:chainId` in Express is `{chainId}` in OpenAPI. */
const toPathTemplate = (path: string): string => path.replace(/:(\w+)/g, '{$1}')

/**
 * The document is inconsistent about the trailing slash on a router root —
 * `/list/` and `/image/` carry one, `/networks` and `/stats` do not. That is
 * cosmetic, and comparing on the stripped form keeps this test from failing
 * over it while still catching a genuinely absent path.
 */
const withoutTrailingSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)

const documented = new Map<string, Set<string>>()
for (const [path, methods] of Object.entries(openapi.paths as Record<string, Record<string, unknown>>)) {
  const key = withoutTrailingSlash(path)
  const present = documented.get(key) ?? new Set<string>()
  for (const method of HTTP_METHODS) if (methods[method]) present.add(method)
  documented.set(key, present)
}

const routesSource = readSource('routes.ts')

/** Routes registered straight onto the top-level router, not via a mount. */
const topLevelRoutes = registrationsIn(routesSource).filter(
  ({ method, path }) => !(method === 'use' && MOUNTS.some((mount) => mount.prefix === path)),
)

const inventory = [
  ...topLevelRoutes.map(({ method, path }) => ({ method, path, source: 'routes.ts' })),
  ...MOUNTS.flatMap(({ prefix, file }) =>
    registrationsIn(readSource(file)).map(({ method, path }) => ({
      method,
      path: `${prefix}${path}`,
      source: file,
    })),
  ),
].flatMap(({ method, path, source }) =>
  expandOptionalSegments(path).map((expanded) => ({
    method,
    source,
    path: withoutTrailingSlash(toPathTemplate(expanded)),
  })),
)

describe('openapi covers the routes the server actually registers', () => {
  it('knows about every router mounted in routes.ts', () => {
    const mounted = registrationsIn(routesSource)
      .filter(({ method, path }) => method === 'use' && path !== '/')
      .map(({ path }) => path)
    expect(
      mounted.sort(),
      'a router is mounted in routes.ts that this test does not know about — add it to MOUNTS',
    ).toEqual(MOUNTS.map((mount) => mount.prefix).sort())
  })

  it.each(MOUNTS)('registers at least one route in $file', ({ file }) => {
    expect(
      registrationsIn(readSource(file)).length,
      `no route registrations found in ${file} — the scanning pattern has drifted from the source`,
    ).toBeGreaterThan(0)
  })

  it('finds the routes registered directly in routes.ts', () => {
    expect(topLevelRoutes.length).toBeGreaterThan(0)
  })

  it('documents every registered path', () => {
    const missing = inventory.filter((route) => !documented.has(route.path))
    expect(
      missing.map((route) => `${route.method.toUpperCase()} ${route.path} (${route.source})`),
      'these routes are registered but absent from the OpenAPI definition',
    ).toEqual([])
  })

  it('documents each registered path under the method it is registered with', () => {
    // `router.use` answers every method, so there is no single method to check
    // against; the path assertion above is the whole check for those.
    const mismatched = inventory
      .filter((route) => route.method !== 'use' && documented.has(route.path))
      .filter((route) => !documented.get(route.path)!.has(route.method))
    expect(
      mismatched.map((route) => `${route.method.toUpperCase()} ${route.path} (${route.source})`),
      'these routes are documented, but not for the method they are registered with',
    ).toEqual([])
  })

  it('pins the documented surface so a deletion has to be deliberate', () => {
    // The count this replaces was `>= 18`, which could not fail: every endpoint
    // added only pushed it further above the floor. An exact figure fails in
    // both directions, and updating it is the one-line acknowledgement that the
    // public surface changed.
    const operations = [...documented.values()].reduce((total, methods) => total + methods.size, 0)
    expect(operations).toBe(26)
  })
})
