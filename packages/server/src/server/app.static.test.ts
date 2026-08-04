/**
 * The built interface must stay reachable.
 *
 * This exists because it went wrong in production. `express.static` was registered in
 * index.ts, which runs after app.ts has finished executing, so it landed at the very end
 * of the middleware stack. That was survivable only for as long as nothing followed the
 * router: static was the last handler, so every request the router declined fell through
 * to it and the site was served.
 *
 * Adding a catch-all 404 to app.ts put a handler that claims *every* unmatched request in
 * front of it. index.html, favicon.png and every hashed asset began answering
 * `{"error":"cannot GET /..."}` instead of the file. The entire site was down while every
 * endpoint kept working, so nothing watching the API noticed.
 *
 * Read from source rather than by importing app.ts, for the same reason
 * openapi-coverage.test.ts does: importing it pulls in the route modules, which pull in the
 * ink-based logger, which cannot render under vitest. That is also why no existing test
 * imported the app — and why the ordering had nothing guarding it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

const appSource = read('app.ts')
const indexSource = read('index.ts')

/** Line index of the first line matching, or -1. Line-based so the order is the real one. */
const lineOf = (source: string, pattern: RegExp): number => source.split('\n').findIndex((line) => pattern.test(line))

const STATIC = /^app\.use\(express\.static\(/
const ROUTER = /^app\.use\(router\)/
const NOT_FOUND = /^app\.use\(notFoundMiddleware\)/

describe('static file serving', () => {
  it('registers the static handler and the catch-all this test compares', () => {
    // Guard the comparisons below. A missing line yields -1, and -1 < -1 is false while
    // -1 < 40 is true, so without this a deleted static handler could leave the ordering
    // assertions passing while asserting nothing.
    expect(lineOf(appSource, STATIC), 'app.ts no longer registers express.static').toBeGreaterThanOrEqual(0)
    expect(lineOf(appSource, NOT_FOUND), 'app.ts no longer registers the catch-all 404').toBeGreaterThanOrEqual(0)
    expect(lineOf(appSource, ROUTER), 'app.ts no longer registers the router').toBeGreaterThanOrEqual(0)
  })

  it('serves static files before the catch-all 404 can claim the request', () => {
    expect(
      lineOf(appSource, STATIC),
      'express.static is registered after the catch-all 404, so the built interface is unreachable ' +
        'and every asset answers a JSON 404 — this is what took the site down once already',
    ).toBeLessThan(lineOf(appSource, NOT_FOUND))
  })

  it('serves static files before the router, so a real file always wins', () => {
    expect(lineOf(appSource, STATIC)).toBeLessThan(lineOf(appSource, ROUTER))
  })

  it('registers no middleware in index.ts, where it would land behind the catch-all', () => {
    // The general form of the bug. index.ts imports app.ts, so by the time it runs, the
    // catch-all is already on the stack and anything added here is dead code that looks
    // live. Registering middleware belongs in app.ts, in a position the reader can see.
    const registrations = indexSource.split('\n').filter((line) => /^app\.use\(/.test(line))
    expect(
      registrations,
      'index.ts runs after app.ts, so middleware registered there sits behind the catch-all 404 ' +
        'and never executes — move it into app.ts above the catch-all',
    ).toEqual([])
  })
})
