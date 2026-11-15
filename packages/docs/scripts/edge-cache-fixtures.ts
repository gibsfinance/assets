/**
 * @module edge-cache-fixtures
 * Answers shaped like Cloudflare's entrypoint answer for the cache settings phase, for the tests.
 *
 * The identifiers are placeholders. The expressions and settings are the ones gib.show uses, so the
 * tests check the export against the real shape without a network. Imported by tests only.
 */

/** The page rule, as Cloudflare returns it. Rules come back in no particular order. */
export const PAGE_RULE_ANSWER = {
  id: 'fixture-rule-page',
  version: '2',
  action: 'set_cache_settings',
  expression: '(http.host in {"gib.show" "staging.gib.show"} and http.request.uri.path in {"/" "/index.html"})',
  description: 'page: cache index.html at the edge for 60s',
  last_updated: '2026-11-01T00:00:00.000000Z',
  ref: 'fixture-ref-page',
  enabled: true,
  action_parameters: {
    browser_ttl: { mode: 'respect_origin' },
    cache: true,
    edge_ttl: { default: 60, mode: 'override_origin' },
  },
}

/** The content rule, as Cloudflare returns it. It has a status code lifetime and no browser setting. */
export const CONTENT_RULE_ANSWER = {
  id: 'fixture-rule-content',
  version: '3',
  action: 'set_cache_settings',
  expression:
    '(http.request.uri.path wildcard r"/image/*") or (http.request.uri.path wildcard r"/list/*") or (http.request.uri.path wildcard r"/token/*") or (http.request.uri.path wildcard r"/sprite/*") or (http.request.uri.path wildcard r"/stats") or (http.request.uri.path wildcard r"/networks")',
  description: 'content',
  last_updated: '2026-11-01T00:00:00.000000Z',
  ref: 'fixture-ref-content',
  enabled: true,
  action_parameters: {
    cache: true,
    edge_ttl: {
      mode: 'respect_origin',
      status_code_ttl: [{ status_code: 404, value: 3600 }],
    },
  },
}

/** The whole entrypoint answer: a successful envelope with both rules. */
export const ENTRYPOINT_ANSWER = {
  success: true,
  errors: [],
  messages: [],
  result: {
    id: 'fixture-ruleset',
    name: 'default',
    description: '',
    kind: 'zone',
    version: '7',
    last_updated: '2026-11-01T00:00:00.000000Z',
    phase: 'http_request_cache_settings',
    rules: [PAGE_RULE_ANSWER, CONTENT_RULE_ANSWER],
  },
}
