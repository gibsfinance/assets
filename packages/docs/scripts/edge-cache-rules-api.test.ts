import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkEdgeCacheRules,
  entrypointUrl,
  exportEdgeCacheRules,
  fetchLiveRuleSet,
  isPageBlockCurrent,
  readCloudflareSettings,
  readCommittedRuleSet,
  type EdgeCachePaths,
  type FetchFunction,
  type FetchResponse,
} from './edge-cache-rules-api.ts'
import { EDGE_CACHE_BLOCK_END, EDGE_CACHE_BLOCK_START } from './edge-cache-page.ts'
import { sanitizeRuleSet } from './edge-cache-rules.ts'
import { CONTENT_RULE_ANSWER, ENTRYPOINT_ANSWER, PAGE_RULE_ANSWER } from './edge-cache-fixtures.ts'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageDirectory = path.join(scriptsDirectory, '..')
const committedPaths: EdgeCachePaths = {
  rulesFile: path.join(packageDirectory, 'src', 'data', 'edge-cache-rules.json'),
  pageFile: path.join(packageDirectory, 'src', 'content', 'docs', 'api-reference', 'caching.md'),
}
const settings = { zoneId: 'fixture-zone', apiToken: 'fixture-token' }
const ANSWER_RULES = sanitizeRuleSet([PAGE_RULE_ANSWER, CONTENT_RULE_ANSWER])

/** A fake fetch that answers with the given body and status, and records each request. */
const fakeFetch = (options: { body: unknown; ok?: boolean; status?: number; bodyIsNotJson?: boolean }) => {
  const requests: { url: string; headers: Record<string, string> }[] = []
  const fetchFunction: FetchFunction = async (url, init) => {
    requests.push({ url, headers: init.headers })
    const response: FetchResponse = {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      json: async () => {
        if (options.bodyIsNotJson) throw new SyntaxError('Unexpected token')
        return options.body
      },
    }
    return response
  }
  return { fetchFunction, requests }
}

/** A caching page whose generated part holds an old table. */
const pageWithOldTable = `Intro.\n\n${EDGE_CACHE_BLOCK_START}\n\nold table\n\n${EDGE_CACHE_BLOCK_END}\n\nOutro.\n`

describe('readCloudflareSettings', () => {
  it('reads the zone and the token from the environment', () => {
    expect(readCloudflareSettings({ CLOUDFLARE_ZONE_ID: 'zone', CLOUDFLARE_API_TOKEN: 'token' })).toEqual({
      zoneId: 'zone',
      apiToken: 'token',
    })
  })

  it('names the zone variable when it is missing or empty, without a value', () => {
    expect(() => readCloudflareSettings({ CLOUDFLARE_API_TOKEN: 'token' })).toThrow('CLOUDFLARE_ZONE_ID is not set')
    expect(() => readCloudflareSettings({ CLOUDFLARE_ZONE_ID: '', CLOUDFLARE_API_TOKEN: 'token' })).toThrow(
      'CLOUDFLARE_ZONE_ID is not set',
    )
  })

  it('names the token variable when it is missing', () => {
    expect(() => readCloudflareSettings({ CLOUDFLARE_ZONE_ID: 'zone' })).toThrow('CLOUDFLARE_API_TOKEN is not set')
  })
})

describe('entrypointUrl', () => {
  it('points at the entrypoint of the cache settings phase for the zone', () => {
    expect(entrypointUrl('zone')).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone/rulesets/phases/http_request_cache_settings/entrypoint',
    )
  })

  it('encodes the zone identifier for the path', () => {
    expect(entrypointUrl('a/b')).toContain('/zones/a%2Fb/rulesets/')
  })
})

describe('fetchLiveRuleSet', () => {
  it('sends the token as a bearer header and returns the sanitized rules', async () => {
    const { fetchFunction, requests } = fakeFetch({ body: ENTRYPOINT_ANSWER })
    const live = await fetchLiveRuleSet({ settings, fetchFunction })
    expect(requests).toEqual([
      {
        url: entrypointUrl('fixture-zone'),
        headers: { Authorization: 'Bearer fixture-token', Accept: 'application/json' },
      },
    ])
    expect(live).toEqual(ANSWER_RULES)
  })

  it('names the refusal Cloudflare gives, and never the token', async () => {
    const { fetchFunction } = fakeFetch({
      body: { success: false, errors: [{ message: 'Authentication error' }] },
      ok: false,
      status: 403,
    })
    const failure = await fetchLiveRuleSet({ settings, fetchFunction }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Cloudflare refused the request: Authentication error')
    expect((failure as Error).message).not.toContain('fixture-token')
  })

  it('reports the status when an error answer has a valid body but no refusal', async () => {
    const body = { success: true, result: { phase: 'http_request_cache_settings', rules: [] } }
    const { fetchFunction } = fakeFetch({ body, ok: false, status: 500 })
    await expect(fetchLiveRuleSet({ settings, fetchFunction })).rejects.toThrow('Cloudflare answered HTTP 500')
  })

  it('reports the status, not the body, when an error answer is not JSON', async () => {
    const { fetchFunction } = fakeFetch({ body: undefined, bodyIsNotJson: true, ok: false, status: 502 })
    await expect(fetchLiveRuleSet({ settings, fetchFunction })).rejects.toThrow(
      'Cloudflare answered HTTP 502 with a body that is not JSON',
    )
  })

  it('refuses a successful answer that is not JSON', async () => {
    const { fetchFunction } = fakeFetch({ body: undefined, bodyIsNotJson: true })
    await expect(fetchLiveRuleSet({ settings, fetchFunction })).rejects.toThrow(
      'Cloudflare answered HTTP 200 with a body that is not JSON',
    )
  })
})

describe('readCommittedRuleSet', () => {
  it('reads a committed rule set', () => {
    expect(readCommittedRuleSet('{"rules": []}')).toEqual({ rules: [] })
  })

  it('refuses text that is not JSON', () => {
    expect(() => readCommittedRuleSet('{')).toThrow()
  })

  it('refuses JSON that is not an object with a list of rules', () => {
    expect(() => readCommittedRuleSet('null')).toThrow('the committed rules file has no list of rules')
    expect(() => readCommittedRuleSet('5')).toThrow('the committed rules file has no list of rules')
    expect(() => readCommittedRuleSet('{}')).toThrow('the committed rules file has no list of rules')
    expect(() => readCommittedRuleSet('{"rules": {}}')).toThrow('the committed rules file has no list of rules')
  })
})

describe('exportEdgeCacheRules and checkEdgeCacheRules', () => {
  let directory: string
  let paths: EdgeCachePaths

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'edge-cache-rules-'))
    paths = {
      rulesFile: path.join(directory, 'data', 'edge-cache-rules.json'),
      pageFile: path.join(directory, 'caching.md'),
    }
    await writeFile(paths.pageFile, pageWithOldTable)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes the sanitized rules and rewrites the table on the page', async () => {
    const { fetchFunction } = fakeFetch({ body: ENTRYPOINT_ANSWER })

    const count = await exportEdgeCacheRules({ settings, fetchFunction, paths })

    expect(count).toBe(2)
    expect(readCommittedRuleSet(await readFile(paths.rulesFile, 'utf8'))).toEqual(ANSWER_RULES)
    const page = await readFile(paths.pageFile, 'utf8')
    expect(page).toContain('| content')
    expect(page).not.toContain('old table')
    expect(page.startsWith('Intro.')).toBe(true)
  })

  it('reports nothing when the live rules match the committed file', async () => {
    await exportEdgeCacheRules({ settings, fetchFunction: fakeFetch({ body: ENTRYPOINT_ANSWER }).fetchFunction, paths })

    const differences = await checkEdgeCacheRules({
      settings,
      fetchFunction: fakeFetch({ body: ENTRYPOINT_ANSWER }).fetchFunction,
      paths,
    })

    expect(differences).toEqual([])
  })

  it('names the differences between the committed file and the live rules', async () => {
    await exportEdgeCacheRules({ settings, fetchFunction: fakeFetch({ body: ENTRYPOINT_ANSWER }).fetchFunction, paths })
    const changed = {
      ...ENTRYPOINT_ANSWER,
      result: { ...ENTRYPOINT_ANSWER.result, rules: [PAGE_RULE_ANSWER, { ...CONTENT_RULE_ANSWER, enabled: false }] },
    }

    const differences = await checkEdgeCacheRules({
      settings,
      fetchFunction: fakeFetch({ body: changed }).fetchFunction,
      paths,
    })

    expect(differences).toEqual(['rule "content": enabled is true in the committed file and false live'])
  })
})

describe('the committed files', () => {
  it('hold the export of the answer the tests use', async () => {
    expect(readCommittedRuleSet(await readFile(committedPaths.rulesFile, 'utf8'))).toEqual(ANSWER_RULES)
  })

  it('draw the same table on the caching page as the committed rules file', async () => {
    expect(await isPageBlockCurrent(committedPaths)).toBe(true)
  })

  it('reports a page whose table is out of date', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'edge-cache-page-'))
    try {
      const pageFile = path.join(directory, 'caching.md')
      await writeFile(pageFile, pageWithOldTable)
      expect(await isPageBlockCurrent({ rulesFile: committedPaths.rulesFile, pageFile })).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
