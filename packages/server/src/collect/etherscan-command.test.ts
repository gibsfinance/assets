import { describe, expect, it, vi } from 'vitest'
import { PRO_REFUSAL } from './__testing__/etherscan-fixtures'
import type { EtherscanCapabilityReport } from './etherscan-capability'
import { runEtherscanCommand } from './etherscan-command'
import { readEtherscanSettings } from './etherscan-settings'

const KEY = 'SECRETKEY123'
const settings = readEtherscanSettings({ ETHERSCAN_API_KEY: KEY })

const reportWith = (outcome: 'ok' | 'requires-pro'): EtherscanCapabilityReport => ({
  keyConfigured: true,
  chains: [
    {
      chainId: 1,
      name: 'Ethereum',
      endpoints: { tokeninfo: { outcome, detail: outcome === 'ok' ? 'OK' : PRO_REFUSAL } },
    },
  ],
})

const collectOutput = () => {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    output: { print: (text: string) => printed.push(text), printError: (text: string) => errors.push(text) },
  }
}

describe('etherscan check', () => {
  it('prints the report and exits 0 when a chain is usable', async () => {
    const { printed, output } = collectOutput()
    const probe = vi.fn(async () => reportWith('ok'))

    const exitCode = await runEtherscanCommand(['check'], { settings, probe, output })

    expect(exitCode).toBe(0)
    expect(probe).toHaveBeenCalledWith(settings)
    expect(printed.join('\n')).toContain('Usable chains: Ethereum (1)')
  })

  it('exits 1 when no chain is usable, and the output holds no key', async () => {
    const { printed, output } = collectOutput()

    const exitCode = await runEtherscanCommand(['check'], {
      settings,
      probe: async () => reportWith('requires-pro'),
      output,
    })

    expect(exitCode).toBe(1)
    expect(printed.join('\n')).toContain(PRO_REFUSAL)
    expect(printed.join('\n')).not.toContain(KEY)
  })

  it('probes through the real client by default, with no key making no call', async () => {
    const { printed, output } = collectOutput()

    const exitCode = await runEtherscanCommand(['check'], {
      settings: readEtherscanSettings({}),
      output,
    })

    expect(exitCode).toBe(1)
    expect(printed.join('\n')).toContain('key not set')
    expect(printed.join('\n')).toContain('ETHERSCAN_API_KEY is not set')
  })

  it('reports a command it does not know on the error output and exits 1', async () => {
    const { errors, output } = collectOutput()

    expect(await runEtherscanCommand(['nope'], { settings, output })).toBe(1)
    expect(errors.join('\n')).toContain('nope')
  })

  it('asks for a command when none is given', async () => {
    const { errors, output } = collectOutput()

    expect(await runEtherscanCommand([], { settings, output })).toBe(1)
    expect(errors.join('\n')).toContain('name a command: check')
  })

  it('reports an error that is not an Error object as text', async () => {
    const { errors, output } = collectOutput()

    const exitCode = await runEtherscanCommand(['check'], {
      settings,
      probe: async () => Promise.reject('plain'),
      output,
    })

    expect(exitCode).toBe(1)
    expect(errors).toEqual(['plain'])
  })
})

describe('etherscan command output', () => {
  it('writes to the console by default', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await runEtherscanCommand(['check'], { settings, probe: async () => reportWith('ok') })
      await runEtherscanCommand(['nope'], { settings })
      expect(log).toHaveBeenCalled()
      expect(error).toHaveBeenCalled()
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })
})
