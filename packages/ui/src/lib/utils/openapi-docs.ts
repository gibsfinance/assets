/**
 * @module openapi-docs
 * Pure transforms from the served OpenAPI 3.1 definition (/openapi.json) to
 * the docs page's render model. The docs page owns no endpoint data of its
 * own — sections come from spec tags (in declaration order), cards from
 * operations, live example URLs from the x-example extension.
 */

export interface OpenApiOperation {
  tags?: string[]
  summary?: string
  description?: string
  'x-example'?: string
}

export interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string; description?: string }
  tags?: { name: string; description?: string }[]
  paths: Record<string, Record<string, OpenApiOperation>>
}

export interface DocsEndpoint {
  method: string
  path: string
  description: string
  example?: string
}

export interface DocsEndpointSection {
  id: string
  label: string
  description?: string
  endpoints: DocsEndpoint[]
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

/** Anchor id for a tag name: 'Networks & Stats' → 'networks-stats'. */
export function sectionIdForTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Group the spec's operations into docs sections, one per declared tag, in
 * tag declaration order. Operations keep path order within a section. The
 * x-example relative URL is resolved against apiBase so EndpointCard can
 * probe it live.
 */
export function specToSections(spec: OpenApiDocument, apiBase: string): DocsEndpointSection[] {
  const sections = (spec.tags ?? []).map((tag) => ({
    id: sectionIdForTag(tag.name),
    label: tag.name,
    description: tag.description,
    endpoints: [] as DocsEndpoint[],
  }))
  const byTag = new Map(sections.map((section) => [section.label, section]))

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = methods[method]
      if (!op) continue
      const example = op['x-example']
      const endpoint: DocsEndpoint = {
        method: method.toUpperCase(),
        path,
        description: op.summary ?? '',
        ...(example ? { example: `${apiBase}${example}` } : {}),
      }
      for (const tag of op.tags ?? []) {
        byTag.get(tag)?.endpoints.push(endpoint)
      }
    }
  }

  return sections.filter((section) => section.endpoints.length > 0)
}
