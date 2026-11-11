import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Whether the emulator tests should run. They start Docker containers, so they are off unless
 * `IMAGE_STORE_EMULATORS=1` is set (`yarn workspace server run test:emulators` sets it).
 */
export const emulatorsEnabled = process.env.IMAGE_STORE_EMULATORS === '1'

/** The reason shown in the test report when emulator suites are skipped. */
export const EMULATORS_SKIP_REASON = 'set IMAGE_STORE_EMULATORS=1 to run the Docker emulator tests'

/** A running container and the host ports its container ports were published on. */
export type RunningEmulator = {
  /** Host port for each container port asked for, by container port. */
  ports: Record<number, number>
  /** Stops and removes the container. */
  stop: () => Promise<void>
}

/** What to start. */
export type EmulatorOptions = {
  /** Image name, with tag. */
  image: string
  /** Container ports to publish on random free host ports, bound to 127.0.0.1 only. */
  containerPorts: number[]
  /** Environment variables for the container. */
  environment?: Record<string, string>
  /** Arguments after the image name. */
  command?: string[]
  /** Resolves when the service answers. Called repeatedly until it does or time runs out. */
  isReady: (ports: Record<number, number>) => Promise<boolean>
  /** How long to wait for readiness, in milliseconds. Defaults to 60 seconds. */
  readyTimeoutMs?: number
}

/**
 * Starts a throwaway container and waits until the service inside answers.
 *
 * @param options See {@link EmulatorOptions}.
 * @returns The published ports and a way to stop it.
 */
export async function startEmulator(options: EmulatorOptions): Promise<RunningEmulator> {
  const { image, containerPorts, environment = {}, command = [], isReady, readyTimeoutMs = 60_000 } = options
  const args = ['run', '-d', '--rm']
  for (const port of containerPorts) args.push('-p', `127.0.0.1::${port}`)
  for (const [name, value] of Object.entries(environment)) args.push('-e', `${name}=${value}`)
  const { stdout } = await run('docker', [...args, image, ...command])
  const containerId = stdout.trim()
  const stop = async () => {
    await run('docker', ['rm', '-f', containerId]).catch(() => undefined)
  }

  try {
    const ports: Record<number, number> = {}
    for (const port of containerPorts) {
      const mapped = await run('docker', ['port', containerId, `${port}/tcp`])
      ports[port] = Number(/:(\d+)\s*$/m.exec(mapped.stdout.trim().split('\n')[0])?.[1])
    }
    const deadline = Date.now() + readyTimeoutMs
    while (!(await isReady(ports).catch(() => false))) {
      if (Date.now() > deadline) throw new Error(`${image} did not become ready in ${readyTimeoutMs} ms`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return { ports, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

/** A random lowercase name, so each test gets a prefix, bucket or container of its own. */
export const randomName = (): string => `t${Math.random().toString(36).slice(2, 10)}`

/** Waits for a number of milliseconds. Emulators stamp objects to the second, so renewals need a pause. */
export const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))
