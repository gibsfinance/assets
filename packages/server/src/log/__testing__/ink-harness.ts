import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'

/** Width given to the fake terminal; wide enough that no test line wraps. */
const FAKE_TERMINAL_COLUMNS = 400

/**
 * Streams standing in for a terminal. Ink accepts any Node.js stream, so a test
 * can own what Ink writes and read it back instead of drawing on the real screen.
 *
 * This file must not import `ink`: `App.test.tsx` imports it from inside the
 * factory that replaces `ink`, and an import back would wait on itself.
 */
export const createInkStreams = () => {
  const frames: string[] = []
  // A Writable, not a PassThrough: a PassThrough raises no event for an empty
  // write, and an empty frame (everything hidden) is a frame a test must see.
  const stdout = Object.assign(
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        frames.push(stripVTControlCharacters(chunk.toString('utf8')))
        done()
      },
    }),
    { columns: FAKE_TERMINAL_COLUMNS, isTTY: false },
  )
  const stdin = Object.assign(new PassThrough(), {
    isTTY: false,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  })
  const stderr = new PassThrough()
  return { stdout, stdin, stderr, frames }
}

/** Options that keep Ink off the real console and the real terminal. */
export const inkOptionsFor = (streams: ReturnType<typeof createInkStreams>) => ({
  stdout: streams.stdout as unknown as NodeJS.WriteStream,
  stdin: streams.stdin as unknown as NodeJS.ReadStream,
  stderr: streams.stderr as unknown as NodeJS.WriteStream,
  // `debug` writes every frame in full instead of erasing and redrawing, so each
  // frame is a plain string a test can compare.
  debug: true,
  // Patching the console cannot run under vitest.
  patchConsole: false,
  exitOnCtrlC: false,
})
