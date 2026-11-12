// Fails the build when a built page has a native <select> element, after `astro build`.
//
// Usage: node scripts/check-no-select.ts   (run from packages/docs)
//
// See no-native-select.ts for the rule and why it exists.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeNativeSelects, findNativeSelects } from './no-native-select.ts'

const packageDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const offenders = await findNativeSelects(path.join(packageDirectory, 'dist'))
const message = describeNativeSelects(offenders)
if (message) {
  console.error(message)
  process.exit(1)
}
console.log('no native <select> elements in the built site')
