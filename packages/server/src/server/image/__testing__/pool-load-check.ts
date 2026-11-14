/**
 * Plain-node check of the remote loader with its default sanitizer. It is run the way the server runs
 * (`node --import ./src/bin/register-hooks.ts`), by `sanitizer-pool.plain-node.test.ts`, which reads the
 * report on the last line of standard output.
 *
 * It first loads two small logos, so the worker has started: a worker's start-up pauses the main thread for a
 * few hundred milliseconds, once, and a server pays that once. Then it loads two logos of about 360 KB at once,
 * which the one worker cleans in turn, and a timer records the longest pause between its ticks. A sanitizer that
 * runs on the main thread shows as one long pause; one that runs in a worker does not.
 */
import { createRemoteImageLoader } from '../remote-image'

const PATH_COUNT = 8_000
const body = Array.from(
  { length: PATH_COUNT },
  (_, index) =>
    `<path d="M${index} 0L${index + 1} 1L0 ${index}Z" fill="#${(index % 4096).toString(16).padStart(3, '0')}"/>`,
).join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`
const smallSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>'
const fetchImpl = (async (uri: string) =>
  new Response(String(uri).includes('warm') ? smallSvg : svg)) as unknown as typeof fetch
const megabytes = (bytes: number): number => Math.round(bytes / (1024 * 1024))

const loader = createRemoteImageLoader({ fetchImpl })
await Promise.all([
  loader.load({ uri: 'https://cdn.example/warm-one.svg', ext: '.svg' }),
  loader.load({ uri: 'https://cdn.example/warm-two.svg', ext: '.svg' }),
])

let longestPauseMs = 0
let lastTick = performance.now()
const ticker = setInterval(() => {
  const now = performance.now()
  longestPauseMs = Math.max(longestPauseMs, now - lastTick)
  lastTick = now
}, 5)
const rssBefore = process.memoryUsage().rss
const outputs = await Promise.all([
  loader.load({ uri: 'https://cdn.example/one.svg', ext: '.svg' }),
  loader.load({ uri: 'https://cdn.example/two.svg', ext: '.svg' }),
])
clearInterval(ticker)
const report = {
  svgBytes: Buffer.byteLength(svg),
  outputBytes: outputs.map((output) => (Buffer.isBuffer(output) ? output.length : null)),
  longestPauseMs: Math.round(longestPauseMs),
  rssMb: { before: megabytes(rssBefore), after: megabytes(process.memoryUsage().rss) },
}
console.log(JSON.stringify(report))
process.exit(0)
