import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInkStreams } from './__testing__/ink-harness'

// Every Ink render builds a layout engine and a React tree; on a busy runner one
// render can take most of the default five seconds.
vi.setConfig({ testTimeout: 15_000 })

// App keeps its state in module variables, so every test loads a fresh copy of
// the module. The pieces it reaches outside itself are replaced here:
//   - `ink` draws into a stream the test owns instead of the real terminal.
//   - `../utils` is replaced by the one export App uses. The real module creates
//     the terminal through App at load, and importing App first trips that cycle;
//     the real entry point imports utils first and never sees it.
//   - `../logger` records what would have been logged.
const harness = vi.hoisted(() => ({
  streams: undefined as unknown as ReturnType<typeof import('./__testing__/ink-harness').createInkStreams>,
  controller: undefined as unknown as AbortController,
  logMock: vi.fn(),
  unmountFailure: undefined as Error | undefined,
}))

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>()
  const { inkOptionsFor: optionsFor } = await import('./__testing__/ink-harness')
  return {
    ...actual,
    render: (node: React.ReactNode) => {
      const instance = actual.render(node, optionsFor(harness.streams))
      if (!harness.unmountFailure) return instance
      return {
        ...instance,
        unmount: () => {
          throw harness.unmountFailure
        },
      }
    },
  }
})
vi.mock('../utils', () => ({
  // A getter, so each freshly loaded copy of App sees the controller made for its own test.
  get controller() {
    return harness.controller
  },
}))
vi.mock('../logger', () => ({ log: harness.logMock }))

type App = typeof import('./App')

let sigintHandler: (() => void) | undefined
let loaded: App | undefined

const loadApp = async (options: { doesRender?: boolean } = {}) => {
  const { doesRender = true } = options
  vi.resetModules()
  vi.stubEnv('DISABLE_TERMINAL', doesRender ? '0' : '1')
  harness.streams = createInkStreams()
  harness.controller = new AbortController()
  harness.logMock.mockClear()
  harness.unmountFailure = undefined
  sigintHandler = undefined
  // App registers its SIGINT handler while the module loads. Hold every SIGINT
  // registration made during that load, and take the last one: Ink's own
  // dependencies may register theirs first, and later in the run.
  const originalOn = process.on.bind(process)
  const registeredAtLoad: (() => void)[] = []
  let isLoading = true
  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
    if (event !== 'SIGINT' || !isLoading) return originalOn(event, handler)
    registeredAtLoad.push(handler)
    return process
  }) as typeof process.on)
  loaded = await import('./App')
  isLoading = false
  sigintHandler = registeredAtLoad.at(-1)
  return loaded
}

/** The last frame Ink wrote. Ink ends every debug run with a lone newline on unmount; skip it. */
const lastFrame = () => harness.streams.frames.filter((frame) => frame !== '\n').at(-1) ?? ''

afterEach(() => {
  loaded?.destroyTerminal()
  // A throttled redraw may still be pending; with rendering off it cannot build a new terminal.
  loaded?.setDoesRender(false)
  loaded = undefined
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('rendering switch', () => {
  it('renders by default', async () => {
    const app = await loadApp()
    expect(app.getDoesRender()).toBe(true)
  })

  it('starts disabled when DISABLE_TERMINAL is 1, so log output stays readable in a pipeline', async () => {
    const app = await loadApp({ doesRender: false })
    expect(app.getDoesRender()).toBe(false)
  })

  it('draws nothing while rendering is disabled', async () => {
    const app = await loadApp({ doesRender: false })
    app.createTerminal()
    app.forceRerender()
    expect(harness.streams.frames).toEqual([])
  })

  it('runs doLog work only when the terminal is not drawing', async () => {
    // Plain log lines and the live view would overwrite each other if both ran.
    const app = await loadApp()
    const work = vi.fn()
    app.doLog(work)
    expect(work).not.toHaveBeenCalled()
    app.setDoesRender(false)
    app.doLog(work)
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('stops drawing when rendering is switched off, and draws again when it is switched on', async () => {
    const app = await loadApp()
    app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    app.forceRerender()
    app.setDoesRender(false)
    const framesAfterOff = harness.streams.frames.length
    app.forceRerender()
    expect(harness.streams.frames.length).toBe(framesAfterOff)
    app.setDoesRender(true)
    app.forceRerender()
    expect(lastFrame()).toContain('alpha')
  })

  it('does nothing extra when rendering is switched off before any terminal exists', async () => {
    const app = await loadApp()
    expect(() => app.setDoesRender(false)).not.toThrow()
    expect(app.getDoesRender()).toBe(false)
  })

  it('survives an Ink unmount that throws while rendering is switched off', async () => {
    // Switching rendering off happens during shutdown; a throw there must not mask the real exit.
    const app = await loadApp()
    app.forceRerender()
    harness.unmountFailure = new Error('stream closed')
    expect(() => app.setDoesRender(false)).not.toThrow()
    expect(app.getDoesRender()).toBe(false)
    harness.unmountFailure = undefined
  })
})

describe('terminal lifecycle', () => {
  it('draws the first frame on the first render and updates the same terminal after that', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    root.issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    app.forceRerender()
    expect(lastFrame()).toContain('alpha')
    root.get('main')!.issue({ id: 'beta', type: 'setup' })
    app.forceRerender()
    expect(lastFrame()).toContain('beta')
  })

  it('destroyTerminal does nothing when no terminal was drawn', async () => {
    const app = await loadApp()
    expect(() => app.destroyTerminal()).not.toThrow()
  })

  it('destroyTerminal releases the screen, and the next draw starts a new terminal', async () => {
    const app = await loadApp()
    app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    app.forceRerender()
    app.destroyTerminal()
    const framesAfterDestroy = harness.streams.frames.length
    app.forceRerender()
    expect(harness.streams.frames.length).toBeGreaterThan(framesAfterDestroy)
    expect(lastFrame()).toContain('alpha')
  })

  it('refuses a second root, because two roots would draw over each other', async () => {
    const app = await loadApp()
    app.createTerminal()
    expect(() => app.createTerminal()).toThrow('unable to issue the same global key twice')
  })

  it('hands out copies of the global state, so a caller cannot rewrite it', async () => {
    const app = await loadApp()
    app.createTerminal()
    const copy = app.getGlobalInfo()
    copy.terminated = true
    expect(app.getGlobalInfo().terminated).toBe(false)
    expect(app.getGlobalInfo().row).not.toBeNull()
  })
})

describe('redraw scheduling', () => {
  const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

  it('draws at once on a change after a quiet spell, then at most once per 200 milliseconds', async () => {
    // Collectors change counters thousands of times a second. Each change must not cost a frame.
    fakeClock()
    const app = await loadApp()
    const main = app.createTerminal().issue('main', Infinity)
    vi.advanceTimersByTime(200)
    const quiet = harness.streams.frames.length
    const first = main.issue({ id: 'first', type: 'setup' })
    expect(harness.streams.frames.length).toBe(quiet + 1)
    expect(lastFrame()).toContain('first')
    main.issue({ id: 'second', type: 'setup' })
    first.update({ message: 'again' })
    expect(harness.streams.frames.length).toBe(quiet + 1)
    vi.advanceTimersByTime(200)
    expect(harness.streams.frames.length).toBe(quiet + 2)
    expect(lastFrame()).toContain('second')
    expect(lastFrame()).toContain('again')
  })

  it('holds the redraw until a group of changes made inside rerenderAfter is complete', async () => {
    // A frame drawn halfway through a group of changes would show a state that never existed.
    fakeClock()
    const app = await loadApp()
    app.createTerminal().issue('main', Infinity)
    vi.advanceTimersByTime(200)
    const quiet = harness.streams.frames.length
    const result = app.rerenderAfter(() => {
      app.rerender()
      expect(harness.streams.frames.length).toBe(quiet)
      return 'done'
    })
    expect(result).toBe('done')
    expect(harness.streams.frames.length).toBe(quiet + 1)
  })
})

describe('stop', () => {
  const build = async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    const finished = main.issue({ id: 'finished', type: 'setup' })
    finished.complete()
    const unfinished = main.issue({ id: 'unfinished', type: 'storage' })
    const nested = unfinished.issue('inner').issue({ id: 'nested', type: 'setup' })
    app.forceRerender()
    return { app, root, main, finished, unfinished, nested }
  }

  it('does nothing while no terminal has been drawn', async () => {
    const app = await loadApp()
    app.createTerminal()
    app.stop('early')
    expect(app.getGlobalInfo().terminated).toBe(false)
    expect(harness.controller.signal.aborted).toBe(false)
  })

  it('records the final note, marks the run terminated and aborts the shared controller', async () => {
    // Every collector watches the controller; aborting it is how a stop reaches them.
    const { app } = await build()
    app.stop('Stopped by user')
    expect(app.getGlobalInfo().finalNote).toBe('Stopped by user')
    expect(app.getGlobalInfo().terminated).toBe(true)
    expect(harness.controller.signal.aborted).toBe(true)
  })

  it('marks every unfinished row, at any depth, with the stopped status and keeps completed rows', async () => {
    // A row left as "storage" after a stop would look like it is still working.
    const { app } = await build()
    app.stop('Stopped by user')
    const info = app.getGlobalInfo().row!
    const main = info.sections.get('main')!
    expect(main.rows.get('finished')!.type).toBe('complete')
    expect(main.rows.get('unfinished')!.type).toBe('-')
    expect(main.rows.get('unfinished')!.sections.get('inner')!.rows.get('nested')!.type).toBe('-')
    expect(info.type).toBe('-')
  })

  it('stops drawing after a stop, so the last screen stays on the terminal', async () => {
    const { app, main } = await build()
    app.stop('Stopped by user')
    const framesAtStop = harness.streams.frames.length
    main.issue({ id: 'late', type: 'setup' })
    app.rerender()
    expect(harness.streams.frames.length).toBe(framesAtStop)
  })

  it('does not let a row complete after the stop', async () => {
    // A late completion would turn a row the user interrupted into a success.
    const { app, unfinished } = await build()
    app.stop('Stopped by user')
    unfinished.complete()
    expect(app.getGlobalInfo().row!.sections.get('main')!.rows.get('unfinished')!.type).toBe('-')
  })

  it('stops cleanly when the terminal was drawn before any root row existed', async () => {
    const app = await loadApp()
    app.forceRerender()
    app.stop('no rows')
    expect(app.getGlobalInfo().terminated).toBe(true)
    expect(app.getGlobalInfo().row).toBeNull()
  })
})

describe('interrupt signal', () => {
  it('registers one SIGINT handler when the module loads', async () => {
    await loadApp()
    expect(sigintHandler).toBeTypeOf('function')
  })

  it('stops the run on the first interrupt and forces exit if collectors hang past three seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const app = await loadApp()
    app.createTerminal()
    app.forceRerender()
    sigintHandler!()
    expect(app.getGlobalInfo().finalNote).toBe('Stopped by user')
    vi.advanceTimersByTime(2999)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reported).toHaveBeenCalledWith('\nForce exiting — collectors did not stop in time')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits at once on the second interrupt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    await loadApp()
    sigintHandler!()
    expect(exit).not.toHaveBeenCalled()
    sigintHandler!()
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('counters', () => {
  const counterOf = (app: App, key: string) => app.getGlobalInfo().row!.counters.get(key)

  it('creates the same counter on every ancestor so the totals roll up', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const provider = root.issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    provider.increment('token', 'a')
    expect(counterOf(app, 'token')!.current).toEqual(new Set(['a']))
  })

  it('adds the ids of a child to its ancestors without double counting', async () => {
    const app = await loadApp()
    const main = app.createTerminal().issue('main', Infinity)
    const first = main.issue({ id: 'first', type: 'setup' })
    const second = main.issue({ id: 'second', type: 'setup' })
    first.increment('token', new Set(['a', 'b']))
    second.increment('token', new Set(['b', 'c']))
    expect(counterOf(app, 'token')!.current).toEqual(new Set(['a', 'b', 'c']))
  })

  it('returns the updated set from increment and removes ids on decrement', async () => {
    const app = await loadApp()
    const provider = app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    expect(provider.increment('token', new Set(['a', 'b']))).toEqual(new Set(['a', 'b']))
    expect(provider.decrement('token', 'a')).toEqual(new Set(['b']))
    expect(counterOf(app, 'token')!.current).toEqual(new Set(['b']))
  })

  it('creating a provider counter also creates the network and token counters beneath it', async () => {
    // Providers contain networks, which contain tokens; the view expects all three together.
    const app = await loadApp()
    const root = app.createTerminal()
    root.createCounter('provider')
    expect([...app.getGlobalInfo().row!.counters.keys()]).toEqual(['provider', 'network', 'token'])
  })

  it('creating a network counter creates the token counter but not the provider counter', async () => {
    const app = await loadApp()
    app.createTerminal().createCounter('network')
    expect([...app.getGlobalInfo().row!.counters.keys()]).toEqual(['network', 'token'])
  })

  it('creates a custom counter on its own', async () => {
    const app = await loadApp()
    app.createTerminal().createCounter('tasks')
    expect([...app.getGlobalInfo().row!.counters.keys()]).toEqual(['tasks'])
  })

  it('keeps an existing counter, and its ids, when it is created again', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    root.increment('token', 'a')
    root.createCounter('provider')
    expect(counterOf(app, 'token')!.current).toEqual(new Set(['a']))
  })

  it('keeps a counter local when asked, leaving the ancestors alone', async () => {
    const app = await loadApp()
    const provider = app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    provider.createCounter('token', true)
    expect(provider.hasCounter('token')).toBe(true)
    expect(counterOf(app, 'token')).toBeUndefined()
  })

  it('answers hasCounter for counters that exist and ones that do not', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    root.createCounter('tasks')
    expect(root.hasCounter('tasks')).toBe(true)
    expect(root.hasCounter('token')).toBe(false)
  })

  it('merges updates into a counter', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    root.increment('token', 'a')
    root.updateCounter('token', { total: new Set(['a', 'b']) })
    expect(counterOf(app, 'token')).toEqual({ current: new Set(['a']), total: new Set(['a', 'b']) })
  })

  it('refuses to update a counter that does not exist', async () => {
    const app = await loadApp()
    expect(() => app.createTerminal().updateCounter('token', {})).toThrow('counter not found')
  })

  it('grows the expected total from a string or a set, and passes it up', async () => {
    const app = await loadApp()
    const provider = app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    provider.createCounter('token')
    provider.incrementTotal('token', 'a')
    provider.incrementTotal('token', new Set(['a', 'b']))
    expect(counterOf(app, 'token')!.total).toEqual(new Set(['a', 'b']))
  })

  it('refuses to grow the total of a counter that does not exist', async () => {
    const app = await loadApp()
    expect(() => app.createTerminal().incrementTotal('token', 'a')).toThrow('counter not found')
  })

  it('removes a counter, and ignores removing one that is not there', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    root.createCounter('tasks')
    root.removeCounter('tasks')
    root.removeCounter('tasks')
    expect(root.hasCounter('tasks')).toBe(false)
  })
})

describe('rows and sections', () => {
  it('names a row by its parents: sections join with a dot, rows with a space', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    const provider = main.issue({ id: 'alpha', type: 'setup' })
    expect(root.fullId).toBe('')
    expect(main.fullId).toBe('main')
    expect(provider.fullId).toBe('main alpha')
  })

  it('finds an existing section or row, and answers null for a missing one', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    main.issue({ id: 'alpha', type: 'setup' })
    expect(root.get('main')).not.toBeNull()
    expect(root.get('absent')).toBeNull()
    expect(main.get('alpha')).not.toBeNull()
    expect(main.get('absent')).toBeNull()
  })

  it('refuses a duplicate section key', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    root.issue('main')
    expect(() => root.issue('main')).toThrow('duplicate key')
  })

  it('refuses a duplicate row id within a section', async () => {
    const app = await loadApp()
    const main = app.createTerminal().issue('main')
    main.issue({ id: 'alpha', type: 'setup' })
    expect(() => main.issue({ id: 'alpha', type: 'setup' })).toThrow('duplicated row alpha')
  })

  it('limits a section to four rows unless told otherwise', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    root.issue('main')
    expect(app.getGlobalInfo().row!.sections.get('main')!.limit).toBe(4)
    root.issue('wide', 9)
    expect(app.getGlobalInfo().row!.sections.get('wide')!.limit).toBe(9)
  })

  it('updates a row and shows the change', async () => {
    const app = await loadApp()
    const provider = app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    provider.update({ message: 'working', kv: { page: 3 } })
    app.forceRerender()
    expect(lastFrame()).toContain('working')
    expect(lastFrame()).toContain('page=3')
  })

  it('hides a row, and a section, from the view', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    const alpha = main.issue({ id: 'alpha', type: 'setup' })
    alpha.hide()
    root.issue('other', Infinity).issue({ id: 'beta', type: 'setup' })
    root.hideSection('other')
    root.hideSection('absent')
    app.forceRerender()
    expect(lastFrame()).not.toContain('alpha')
    expect(lastFrame()).not.toContain('beta')
  })

  it('completes a row so it joins the done summary', async () => {
    const app = await loadApp()
    const main = app.createTerminal().issue('main', Infinity)
    main.issue({ id: 'alpha', type: 'setup' }).complete()
    app.forceRerender()
    expect(lastFrame()).toContain('1 done')
  })

  it('removes a section, and a row', async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    main.issue({ id: 'alpha', type: 'setup' })
    main.issue({ id: 'beta', type: 'setup' })
    main.removeRow('alpha')
    root.remove('main')
    expect(app.getGlobalInfo().row!.sections.has('main')).toBe(false)
  })

  it('removes a row from the view with removeRow', async () => {
    const app = await loadApp()
    const main = app.createTerminal().issue('main', Infinity)
    main.issue({ id: 'alpha', type: 'setup' })
    main.issue({ id: 'beta', type: 'setup' })
    main.removeRow('alpha')
    app.forceRerender()
    expect(lastFrame()).not.toContain('alpha')
    expect(lastFrame()).toContain('beta')
  })
})

describe('section counters', () => {
  const setup = async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    return { app, root, main }
  }

  it('does not create a counter on the owner just by counting through the section', async () => {
    // A section only forwards; the owner decides which counters exist.
    const { root, main } = await setup()
    expect(main.increment('token', 'a')).toBe(0)
    expect(root.hasCounter('token')).toBe(false)
  })

  it('forwards increment, decrement and totals to an owner that has the counter', async () => {
    const { app, root, main } = await setup()
    root.createCounter('token')
    main.incrementTotal('token', 'a')
    main.increment('token', 'a')
    main.increment('token', 'b')
    main.decrement('token', 'b')
    main.updateCounter('token', { total: new Set(['a', 'b', 'c']) })
    expect(app.getGlobalInfo().row!.counters.get('token')).toEqual({
      current: new Set(['a']),
      total: new Set(['a', 'b', 'c']),
    })
  })

  it('ignores totals, decrements and updates for a counter the owner does not have', async () => {
    const { root, main } = await setup()
    expect(() => {
      main.incrementTotal('token', 'a')
      main.decrement('token', 'a')
      main.updateCounter('token', {})
    }).not.toThrow()
    expect(root.hasCounter('token')).toBe(false)
  })

  it('creates the counter on the owner unless it is asked to stay local', async () => {
    const { root, main } = await setup()
    main.createCounter('token', true)
    expect(root.hasCounter('token')).toBe(false)
    main.createCounter('token')
    expect(root.hasCounter('token')).toBe(true)
  })
})

describe('tasks', () => {
  const setup = async () => {
    const app = await loadApp()
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    return { app, root, main }
  }

  it('counts each task under the "tasks" counter of the owner', async () => {
    const { app, main } = await setup()
    main.task('one', { id: 'one', type: 'storage' })
    main.task('two', { id: 'two', type: 'storage' })
    expect(app.getGlobalInfo().row!.counters.get('tasks')!.current).toEqual(new Set(['one', 'two']))
  })

  it('marks a task as a task so the view can dim it and hide it once done', async () => {
    const { app, main } = await setup()
    main.task('one', { id: 'one', type: 'storage' })
    expect(app.getGlobalInfo().row!.sections.get('main')!.rows.get('one')!.isTask).toBe(true)
  })

  it('removes a finished task, and drops the "tasks" counter with the last one', async () => {
    // An empty "tasks=0" left on the owner would stay on screen for the rest of the run.
    const { app, root, main } = await setup()
    const one = main.task('one', { id: 'one', type: 'storage' })
    const two = main.task('two', { id: 'two', type: 'storage' })
    one.unmount()
    expect(root.hasCounter('tasks')).toBe(true)
    expect(app.getGlobalInfo().row!.sections.get('main')!.rows.has('one')).toBe(false)
    two.unmount()
    expect(root.hasCounter('tasks')).toBe(false)
    expect(app.getGlobalInfo().row!.sections.get('main')!.rows.size).toBe(0)
  })

  it('draws the task while it runs and stops drawing it after unmount', async () => {
    const { app, main } = await setup()
    const task = main.task('fetch-it', { id: 'fetch-it', type: 'storage' })
    app.forceRerender()
    expect(lastFrame()).toContain('fetch-it')
    task.unmount()
    app.forceRerender()
    expect(lastFrame()).not.toContain('fetch-it')
  })
})

describe('log lines while rendering is off', () => {
  const setup = async () => {
    const app = await loadApp({ doesRender: false })
    const root = app.createTerminal()
    const main = root.issue('main', Infinity)
    const alpha = main.issue({ id: 'alpha', type: 'setup' })
    harness.logMock.mockClear()
    return { app, root, main, alpha }
  }

  it('logs a row update with its key-value pairs', async () => {
    const { alpha } = await setup()
    alpha.update({ kv: { page: 1 } })
    expect(harness.logMock).toHaveBeenCalledWith('updating row id=%o, kv=%o', 'main alpha', { page: 1 })
  })

  it('logs a row update that carries no key-value pairs as an empty object', async () => {
    const { alpha } = await setup()
    alpha.update({ message: 'hello' })
    expect(harness.logMock).toHaveBeenCalledWith('updating row id=%o, kv=%o', 'main alpha', {})
  })

  it('logs hiding a row and a section', async () => {
    const { root, alpha } = await setup()
    alpha.hide()
    root.hideSection('main')
    expect(harness.logMock).toHaveBeenCalledWith('hiding row key=%o', 'alpha')
    expect(harness.logMock).toHaveBeenCalledWith('hiding section key=%o', 'main')
  })

  it('logs completing a row, with and without key-value pairs', async () => {
    const { main, alpha } = await setup()
    alpha.update({ kv: { page: 1 } })
    alpha.complete()
    expect(harness.logMock).toHaveBeenCalledWith('completing row key=%o kv=%o', 'alpha', { page: 1 })
    main.issue({ id: 'beta', type: 'setup' }).complete()
    expect(harness.logMock).toHaveBeenCalledWith('completing row key=%o kv=%o', 'beta', {})
  })

  it('logs removing a section', async () => {
    const { root } = await setup()
    root.remove('main')
    expect(harness.logMock).toHaveBeenCalledWith('removing section key=%o', 'main')
  })

  it('logs a counter update with the size of each set', async () => {
    const { alpha } = await setup()
    alpha.createCounter('token')
    alpha.updateCounter('token', { current: new Set(['a', 'b']), total: new Set(['a', 'b', 'c']) })
    expect(harness.logMock).toHaveBeenCalledWith('updating counter %o', { key: 'token', current: 2, total: 3 })
  })

  it('leaves a total that is not set yet out of the counter log', async () => {
    const { alpha } = await setup()
    alpha.createCounter('token')
    alpha.updateCounter('token', { current: new Set(['a']) })
    expect(harness.logMock).toHaveBeenCalledWith('updating counter %o', { key: 'token', current: 1 })
  })

  it('logs removing a counter with only its key', async () => {
    const { alpha } = await setup()
    alpha.createCounter('token')
    alpha.removeCounter('token')
    expect(harness.logMock).toHaveBeenCalledWith('removing counter %o', { key: 'token' })
  })

  it('logs nothing while the terminal is drawing', async () => {
    const app = await loadApp()
    const alpha = app.createTerminal().issue('main', Infinity).issue({ id: 'alpha', type: 'setup' })
    alpha.update({ kv: { page: 1 } })
    alpha.hide()
    alpha.complete()
    alpha.createCounter('token')
    alpha.removeCounter('token')
    expect(harness.logMock).not.toHaveBeenCalled()
  })
})
