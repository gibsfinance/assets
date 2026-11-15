import { describe, expect, it } from 'vitest'
import {
  compareRuleSets,
  describeBrowserLifetime,
  describeEdgeLifetime,
  readEntrypointRules,
  sanitizeRule,
  sanitizeRuleSet,
  type EdgeCacheRule,
  type EdgeCacheRuleSet,
} from './edge-cache-rules.ts'
import { CONTENT_RULE_ANSWER, ENTRYPOINT_ANSWER, PAGE_RULE_ANSWER } from './edge-cache-fixtures.ts'

/** Build a raw rule from the content rule, with some fields replaced. */
const rawRule = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  ...CONTENT_RULE_ANSWER,
  ...overrides,
})

/** Build a raw rule with the given action parameters, keeping the content rule's other fields. */
const rawRuleWithParameters = (parameters: Record<string, unknown>): Record<string, unknown> =>
  rawRule({ action_parameters: { cache: true, ...parameters } })

/** Build a committed rule with defaults, so each test states only what it changes. */
const committedRule = (overrides: Partial<EdgeCacheRule>): EdgeCacheRule => ({
  description: 'rule',
  enabled: true,
  expression: 'http.request.uri.path eq "/"',
  cacheEnabled: true,
  edge: { mode: 'respect_origin', statusCodes: [] },
  ...overrides,
})

describe('sanitizeRule', () => {
  it('keeps the caching settings of the page rule and drops the identifiers and versions', () => {
    expect(sanitizeRule(PAGE_RULE_ANSWER)).toEqual({
      description: 'page: cache index.html at the edge for 60s',
      enabled: true,
      expression: '(http.host in {"gib.show" "staging.gib.show"} and http.request.uri.path in {"/" "/index.html"})',
      cacheEnabled: true,
      edge: { mode: 'override_origin', seconds: 60, statusCodes: [] },
      browser: { mode: 'respect_origin' },
    })
  })

  it('keeps status code lifetimes and leaves the browser lifetime unset when the rule has none', () => {
    expect(sanitizeRule(CONTENT_RULE_ANSWER)).toEqual({
      description: 'content',
      enabled: true,
      expression: CONTENT_RULE_ANSWER.expression,
      cacheEnabled: true,
      edge: { mode: 'respect_origin', statusCodes: [{ code: 404, seconds: 3600 }] },
    })
  })

  it('sorts status code lifetimes by code', () => {
    const rule = sanitizeRule(
      rawRuleWithParameters({
        edge_ttl: {
          mode: 'respect_origin',
          status_code_ttl: [
            { status_code: 500, value: 0 },
            { status_code: 404, value: 3600 },
          ],
        },
      }),
    )
    expect(rule.edge).toEqual({
      mode: 'respect_origin',
      statusCodes: [
        { code: 404, seconds: 3600 },
        { code: 500, seconds: 0 },
      ],
    })
  })

  it('leaves both lifetimes unset when the rule sets neither', () => {
    expect(sanitizeRule(rawRuleWithParameters({}))).toEqual({
      description: 'content',
      enabled: true,
      expression: CONTENT_RULE_ANSWER.expression,
      cacheEnabled: true,
    })
  })

  it('reads a browser lifetime override with its seconds', () => {
    const rule = sanitizeRule(rawRuleWithParameters({ browser_ttl: { mode: 'override_origin', default: 300 } }))
    expect(rule.browser).toEqual({ mode: 'override_origin', seconds: 300 })
  })

  it('reads a rule that turns caching off', () => {
    expect(sanitizeRule(rawRule({ action_parameters: { cache: false } })).cacheEnabled).toBe(false)
  })

  it('refuses a value that is not an object', () => {
    expect(() => sanitizeRule('content')).toThrow('a rule is not an object')
    expect(() => sanitizeRule(null)).toThrow('a rule is not an object')
    expect(() => sanitizeRule([])).toThrow('a rule is not an object')
  })

  it('refuses a rule without a text description', () => {
    expect(() => sanitizeRule(rawRule({ description: 7 }))).toThrow('a rule: description is not a string')
  })

  it('refuses a top-level setting it does not know, and says where to add it', () => {
    expect(() => sanitizeRule(rawRule({ surprise: true }))).toThrow(
      'rule "content" has settings this export does not know: surprise. Add them to edge-cache-rules.ts before exporting.',
    )
  })

  it('refuses an action other than a cache setting', () => {
    expect(() => sanitizeRule(rawRule({ action: 'rewrite' }))).toThrow(
      'rule "content": action is "rewrite", not set_cache_settings',
    )
  })

  it('refuses an enabled flag that is not true or false', () => {
    expect(() => sanitizeRule(rawRule({ enabled: 'yes' }))).toThrow('rule "content": enabled is not true or false')
  })

  it('refuses an expression that is not text', () => {
    expect(() => sanitizeRule(rawRule({ expression: 1 }))).toThrow('rule "content": expression is not a string')
  })

  it('refuses action parameters that are not an object', () => {
    expect(() => sanitizeRule(rawRule({ action_parameters: 'x' }))).toThrow(
      'rule "content": action_parameters is not an object',
    )
  })

  it('refuses an action parameter it does not know', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ serve_stale: {} }))).toThrow(
      'rule "content" action_parameters has settings this export does not know: serve_stale',
    )
  })

  it('refuses a cache flag that is not true or false', () => {
    expect(() => sanitizeRule(rawRule({ action_parameters: { cache: 'on' } }))).toThrow(
      'rule "content": cache is not true or false',
    )
  })

  it('refuses edge settings that are not an object', () => {
    expect(() => sanitizeRuleSet([rawRuleWithParameters({ edge_ttl: 'x' })])).toThrow(
      'rule "content": edge_ttl is not an object',
    )
  })

  it('refuses an edge setting it does not know', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ edge_ttl: { mode: 'respect_origin', extra: 1 } }))).toThrow(
      'rule "content" edge_ttl has settings this export does not know: extra',
    )
  })

  it('refuses an edge mode it does not know', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ edge_ttl: { mode: 'bypass' } }))).toThrow(
      'rule "content" edge_ttl: mode "bypass" is not one of respect_origin, override_origin',
    )
  })

  it('refuses an edge override without its seconds', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ edge_ttl: { mode: 'override_origin' } }))).toThrow(
      'rule "content" edge_ttl: default is not a whole number of zero or more',
    )
  })

  it('refuses a status code list that is not a list', () => {
    expect(() =>
      sanitizeRule(rawRuleWithParameters({ edge_ttl: { mode: 'respect_origin', status_code_ttl: 5 } })),
    ).toThrow('rule "content": status_code_ttl is not a list')
  })

  it('refuses a status code lifetime that is not an object', () => {
    expect(() =>
      sanitizeRule(rawRuleWithParameters({ edge_ttl: { mode: 'respect_origin', status_code_ttl: [5] } })),
    ).toThrow('rule "content": a status code lifetime is not an object')
  })

  it('refuses a status code lifetime with a setting it does not know', () => {
    expect(() =>
      sanitizeRule(
        rawRuleWithParameters({
          edge_ttl: { mode: 'respect_origin', status_code_ttl: [{ status_code: 404, value: 1, extra: 2 }] },
        }),
      ),
    ).toThrow('rule "content" status code lifetime has settings this export does not know: extra')
  })

  it('refuses the same status code listed twice', () => {
    expect(() =>
      sanitizeRule(
        rawRuleWithParameters({
          edge_ttl: {
            mode: 'respect_origin',
            status_code_ttl: [
              { status_code: 404, value: 1 },
              { status_code: 404, value: 2 },
            ],
          },
        }),
      ),
    ).toThrow('rule "content": a status code is listed twice')
  })

  it('refuses a status code that is not a whole number', () => {
    expect(() =>
      sanitizeRule(
        rawRuleWithParameters({
          edge_ttl: { mode: 'respect_origin', status_code_ttl: [{ status_code: 404.5, value: 1 }] },
        }),
      ),
    ).toThrow('rule "content": status_code is not a whole number of zero or more')
  })

  it('refuses a lifetime that is negative', () => {
    expect(() =>
      sanitizeRule(
        rawRuleWithParameters({
          edge_ttl: { mode: 'respect_origin', status_code_ttl: [{ status_code: 404, value: -1 }] },
        }),
      ),
    ).toThrow('rule "content": value is not a whole number of zero or more')
  })

  it('refuses a lifetime that is not a number', () => {
    expect(() =>
      sanitizeRule(
        rawRuleWithParameters({
          edge_ttl: { mode: 'respect_origin', status_code_ttl: [{ status_code: 404, value: '60' }] },
        }),
      ),
    ).toThrow('rule "content": value is not a whole number of zero or more')
  })

  it('refuses browser settings that are not an object', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ browser_ttl: 'x' }))).toThrow(
      'rule "content": browser_ttl is not an object',
    )
  })

  it('refuses a browser setting it does not know', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ browser_ttl: { mode: 'respect_origin', extra: 1 } }))).toThrow(
      'rule "content" browser_ttl has settings this export does not know: extra',
    )
  })

  it('refuses a browser mode it does not know', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ browser_ttl: { mode: 'bypass_by_default' } }))).toThrow(
      'rule "content" browser_ttl: mode "bypass_by_default" is not one of respect_origin, override_origin',
    )
  })

  it('refuses a browser override without its seconds', () => {
    expect(() => sanitizeRule(rawRuleWithParameters({ browser_ttl: { mode: 'override_origin' } }))).toThrow(
      'rule "content" browser_ttl: default is not a whole number of zero or more',
    )
  })
})

describe('sanitizeRuleSet', () => {
  it('sorts rules by name, so the order does not depend on Cloudflare', () => {
    const sanitized = sanitizeRuleSet([PAGE_RULE_ANSWER, CONTENT_RULE_ANSWER])
    expect(sanitized.rules.map((rule) => rule.description)).toEqual([
      'content',
      'page: cache index.html at the edge for 60s',
    ])
  })

  it('refuses a value that is not a list of rules', () => {
    expect(() => sanitizeRuleSet({})).toThrow('the ruleset has no list of rules')
  })

  it('refuses two rules with the same name', () => {
    expect(() => sanitizeRuleSet([CONTENT_RULE_ANSWER, rawRule({ expression: 'other' })])).toThrow(
      'two rules share a description; rule names must be unique for the export',
    )
  })
})

describe('readEntrypointRules', () => {
  it('returns the rules of a successful answer for the cache settings phase', () => {
    expect(readEntrypointRules(ENTRYPOINT_ANSWER)).toEqual([PAGE_RULE_ANSWER, CONTENT_RULE_ANSWER])
  })

  it('refuses an answer that is not an object', () => {
    expect(() => readEntrypointRules(null)).toThrow('Cloudflare answered with something that is not a JSON object')
  })

  it('names the refusal messages Cloudflare gives', () => {
    expect(() => readEntrypointRules({ success: false, errors: [{ message: 'Unknown zone' }, { code: 1 }] })).toThrow(
      'Cloudflare refused the request: Unknown zone; no detail given',
    )
  })

  it('says no detail was given when the refusal has no list of errors', () => {
    expect(() => readEntrypointRules({ success: false, errors: 'bad' })).toThrow(
      'Cloudflare refused the request: no detail given',
    )
  })

  it('refuses an answer without a result', () => {
    expect(() => readEntrypointRules({ success: true })).toThrow('Cloudflare answered without a result')
  })

  it('refuses an answer for another phase', () => {
    expect(() =>
      readEntrypointRules({ success: true, result: { phase: 'http_response_headers_transform', rules: [] } }),
    ).toThrow('the entrypoint is for phase "http_response_headers_transform", not http_request_cache_settings')
  })
})

describe('compareRuleSets', () => {
  const committedSet: EdgeCacheRuleSet = { rules: [committedRule({ description: 'content' })] }

  it('reports nothing when the two sets match', () => {
    expect(compareRuleSets(committedSet, committedSet)).toEqual([])
  })

  it('reports a rule that is live but not committed', () => {
    expect(compareRuleSets({ rules: [] }, committedSet)).toEqual(['rule "content" is live but not committed'])
  })

  it('reports a rule that is committed but not live', () => {
    expect(compareRuleSets(committedSet, { rules: [] })).toEqual(['rule "content" is committed but not live'])
  })

  it('reports each setting that changed, with both values', () => {
    const live: EdgeCacheRuleSet = {
      rules: [
        committedRule({
          description: 'content',
          enabled: false,
          expression: 'other',
          cacheEnabled: false,
          edge: { mode: 'override_origin', seconds: 60, statusCodes: [] },
          browser: { mode: 'respect_origin' },
        }),
      ],
    }
    expect(compareRuleSets(committedSet, live)).toEqual([
      'rule "content": enabled is true in the committed file and false live',
      'rule "content": expression is "http.request.uri.path eq \\"/\\"" in the committed file and "other" live',
      'rule "content": cacheEnabled is true in the committed file and false live',
      'rule "content": edge is {"mode":"respect_origin","statusCodes":[]} in the committed file and {"mode":"override_origin","seconds":60,"statusCodes":[]} live',
      'rule "content": browser is undefined in the committed file and {"mode":"respect_origin"} live',
    ])
  })

  it('lists differences in rule name order', () => {
    const committed: EdgeCacheRuleSet = {
      rules: [committedRule({ description: 'b' }), committedRule({ description: 'a' })],
    }
    const live: EdgeCacheRuleSet = { rules: [] }
    expect(compareRuleSets(committed, live)).toEqual([
      'rule "a" is committed but not live',
      'rule "b" is committed but not live',
    ])
  })
})

describe('describeEdgeLifetime', () => {
  it('says the edge does not keep a rule that turns caching off', () => {
    expect(describeEdgeLifetime(committedRule({ cacheEnabled: false }))).toBe('Not kept at the edge')
  })

  it('says the origin decides when the rule sets no edge lifetime', () => {
    expect(describeEdgeLifetime(committedRule({ edge: undefined }))).toBe(
      "Not set by this rule, so the origin's Cache-Control header decides",
    )
  })

  it('says the origin decides when there are no status code exceptions', () => {
    expect(describeEdgeLifetime(committedRule({}))).toBe("Follows the origin's Cache-Control header")
  })

  it('names each status code exception', () => {
    expect(
      describeEdgeLifetime(
        committedRule({
          edge: {
            mode: 'respect_origin',
            statusCodes: [
              { code: 404, seconds: 3600 },
              { code: 500, seconds: 0 },
            ],
          },
        }),
      ),
    ).toBe(
      "Follows the origin's Cache-Control header, except 404 answers are kept 3600 seconds and 500 answers are kept 0 seconds",
    )
  })

  it('states an override in seconds, with any exceptions after it', () => {
    expect(
      describeEdgeLifetime(
        committedRule({
          edge: { mode: 'override_origin', seconds: 60, statusCodes: [{ code: 404, seconds: 30 }] },
        }),
      ),
    ).toBe('60 seconds, whatever the origin says, except 404 answers are kept 30 seconds')
  })

  it('states an override with no exceptions', () => {
    expect(
      describeEdgeLifetime(committedRule({ edge: { mode: 'override_origin', seconds: 60, statusCodes: [] } })),
    ).toBe('60 seconds, whatever the origin says')
  })
})

describe('describeBrowserLifetime', () => {
  it('says the origin decides when the rule sets no browser lifetime', () => {
    expect(describeBrowserLifetime(committedRule({ browser: undefined }))).toBe(
      "Not set by this rule, so the origin's Cache-Control header decides",
    )
  })

  it('says the browser follows the origin for a respect mode', () => {
    expect(describeBrowserLifetime(committedRule({ browser: { mode: 'respect_origin' } }))).toBe(
      "Follows the origin's Cache-Control header",
    )
  })

  it('states a browser override in seconds', () => {
    expect(describeBrowserLifetime(committedRule({ browser: { mode: 'override_origin', seconds: 300 } }))).toBe(
      '300 seconds, whatever the origin says',
    )
  })
})
