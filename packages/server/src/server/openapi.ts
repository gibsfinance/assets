/**
 * @module openapi
 * The OpenAPI 3.1 definition for the public API, served at /openapi.json.
 *
 * This document is the single source of truth for endpoint documentation:
 * the UI docs page fetches it and renders one section per tag, one card per
 * operation — updating this file updates the rendered docs with no UI change.
 *
 * Conventions:
 * - `tags` group operations into docs sections; the section anchor id is the
 *   slugified tag name, and tag order here is the table-of-contents order.
 * - `x-example` on every GET operation is a RELATIVE URL exercising the
 *   operation against live data; the docs page prepends its API base and the
 *   smoke tester probes each one. Keep them working.
 * - Chain ids are written in prefixed identifier form (eip155-369); every
 *   endpoint also accepts the bare numeric form.
 */

const CHAIN_ID_PARAM = {
  name: 'chainId',
  in: 'path' as const,
  required: true,
  description:
    'Chain identifier — prefixed form (eip155-369) or bare numeric (369). Chain 0 uses the asset namespace (asset-0).',
  schema: { type: 'string' as const, examples: ['eip155-369', '1'] },
}

const ADDRESS_PARAM = {
  name: 'address',
  in: 'path' as const,
  required: true,
  description: 'Token contract address (checksummed or lowercase).',
  schema: { type: 'string' as const, examples: ['0xA1077a294dDE1B09bB078844df40758a5D0f9a27'] },
}

const PROVIDER_KEY_PARAM = {
  name: 'providerKey',
  in: 'path' as const,
  required: true,
  description: 'Provider slug (e.g. pulsex, coingecko, trustwallet; user submissions are prefixed user-).',
  schema: { type: 'string' as const },
}

const LIST_KEY_PARAM = {
  name: 'listKey',
  in: 'path' as const,
  required: true,
  description: "Provider's list slug (e.g. extended).",
  schema: { type: 'string' as const },
}

const RESIZE_PARAMS = [
  {
    name: 'as',
    in: 'query' as const,
    description: 'Convert output format. Invalid values are silently ignored and the original format is served.',
    schema: { type: 'string' as const, enum: ['webp', 'png', 'jpg', 'jpeg', 'avif'] },
  },
  {
    name: 'w',
    in: 'query' as const,
    description: 'Resize width in pixels (1-2048), fit inside, never enlarged.',
    schema: { type: 'integer' as const, minimum: 1, maximum: 2048 },
  },
  {
    name: 'h',
    in: 'query' as const,
    description: 'Resize height in pixels (1-2048), fit inside, never enlarged.',
    schema: { type: 'integer' as const, minimum: 1, maximum: 2048 },
  },
]

const MODE_PARAM = {
  name: 'mode',
  in: 'query' as const,
  description: 'mode=link responds 302 to the original source URI instead of serving content.',
  schema: { type: 'string' as const, enum: ['link'] },
}

const IMAGE_FILTER_PARAMS = [
  {
    name: 'only',
    in: 'query' as const,
    description: 'Filter source images by type before selection.',
    schema: { type: 'string' as const, enum: ['vector', 'raster'] },
  },
  {
    name: 'providerKey',
    in: 'query' as const,
    description: 'Comma-separated provider slugs to restrict image sources.',
    schema: { type: 'string' as const },
  },
  {
    name: 'listKey',
    in: 'query' as const,
    description: 'Comma-separated list slugs to restrict image sources.',
    schema: { type: 'string' as const },
  },
  MODE_PARAM,
]

const REDIRECT_RESPONSE = {
  '302': { description: 'Redirect to the original source URI (mode=link).' },
}

const EXTENSIONS_PARAM = {
  name: 'extensions',
  in: 'query' as const,
  description: 'Optional token fields to include — comma-separated or repeated.',
  schema: { type: 'string' as const, examples: ['bridgeInfo', 'headerUri', 'bridgeInfo,headerUri'] },
}

const CHAIN_ID_QUERY_PARAM = {
  name: 'chainId',
  in: 'query' as const,
  description: 'Filter tokens to one chain — prefixed form (eip155-369) or bare numeric (369).',
  schema: { type: 'string' as const },
}

const DECIMALS_QUERY_PARAM = {
  name: 'decimals',
  in: 'query' as const,
  description: 'Filter by token decimals. Repeatable (decimals=18&decimals=8).',
  schema: { type: 'string' as const },
}

const IMAGE_RESPONSE = {
  '200': {
    description:
      'Image content. Headers: cache-control (public, max-age), x-resize (original or variant), x-uri (source when known).',
    content: {
      'image/*': { schema: { type: 'string' as const, format: 'binary' } },
    },
  },
  '404': {
    description: 'No matching image.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
}

const TOKEN_LIST_RESPONSE = {
  '200': {
    description: 'Uniswap-style token list.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/TokenList' } } },
  },
  '404': {
    description: 'Unknown provider, list, or order.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
}

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Gib.Show Assets API',
    version: '1.0.0',
    description:
      'Token metadata, token lists, and token/network images across many blockchains. ' +
      'All chain-id inputs accept both the prefixed identifier form (eip155-369) and the bare numeric form (369). ' +
      'Responses are aggressively cacheable; image and list bodies carry cache-control headers.',
    license: { name: 'MIT' },
  },
  servers: [{ url: 'https://gib.show' }, { url: 'https://staging.gib.show' }],
  tags: [
    { name: 'Token Endpoints', description: 'Token lists, ranked per-chain tokens, and list discovery.' },
    { name: 'Image Endpoints', description: 'Token and network images with conversion, resizing, and sprite sheets.' },
    { name: 'Networks & Stats', description: 'Supported networks and per-chain token counts.' },
    { name: 'Submissions', description: 'Community list and image submissions.' },
    { name: 'Service', description: 'Health, this definition, and integration plumbing.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Service'],
        summary: 'Readiness probe — 200 once migrations and cache warmup finish, 503 while starting',
        'x-example': '/health',
        responses: {
          '200': {
            description: 'Server ready.',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string', const: 'ok' } } },
              },
            },
          },
          '503': {
            description: 'Still starting.',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { status: { type: 'string', const: 'starting' } } },
              },
            },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['Service'],
        summary: 'This OpenAPI 3.1 definition — the source the docs page renders from',
        'x-example': '/openapi.json',
        responses: {
          '200': { description: 'The definition.', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/networks': {
      get: {
        tags: ['Networks & Stats'],
        summary: 'All supported networks with chain ids and icon hashes',
        'x-example': '/networks',
        responses: {
          '200': {
            description: 'Network array.',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Network' } } },
            },
          },
        },
      },
    },
    '/stats': {
      get: {
        tags: ['Networks & Stats'],
        summary: 'Per-chain counts of token addresses that have a usable image',
        'x-example': '/stats',
        responses: {
          '200': {
            description: 'Count per chain.',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ChainStat' } } },
            },
          },
        },
      },
    },
    '/list/': {
      get: {
        tags: ['Token Endpoints'],
        summary: 'All available token lists',
        'x-example': '/list/',
        parameters: [
          { name: 'key', in: 'query', description: 'Filter by list slug.', schema: { type: 'string' } },
          { name: 'name', in: 'query', description: 'Filter by list name.', schema: { type: 'string' } },
          { name: 'provider_key', in: 'query', description: 'Filter by provider slug.', schema: { type: 'string' } },
          {
            name: 'chain_id',
            in: 'query',
            description: 'Filter by chain — prefixed form (eip155-369) or bare numeric (369).',
            schema: { type: 'string' },
          },
          { name: 'chain_type', in: 'query', description: 'Filter by chain type.', schema: { type: 'string' } },
          {
            name: 'default',
            in: 'query',
            description: 'Filter to default (true) or non-default (false) lists.',
            schema: { type: 'boolean' },
          },
          { name: 'major', in: 'query', description: 'Filter by major version.', schema: { type: 'integer' } },
          { name: 'minor', in: 'query', description: 'Filter by minor version.', schema: { type: 'integer' } },
          { name: 'patch', in: 'query', description: 'Filter by patch version.', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'List metadata array.',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ListInfo' } } },
            },
          },
          '400': {
            description:
              'Invalid filter value — default must be true or false, version filters must be integers, values must be non-empty.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/list/tokens/{chainId}': {
      get: {
        tags: ['Token Endpoints'],
        summary: 'All deduplicated tokens for a chain, ranked by list priority',
        description:
          'Responses carry cache-control: public, max-age=21600, stale-while-revalidate=86400 ' +
          '(6 hours fresh, 24 hours stale); top chains are kept perpetually warm. ' +
          'Each token carries sources[] showing which lists include it.',
        'x-example': '/list/tokens/eip155-369?limit=20',
        parameters: [
          CHAIN_ID_PARAM,
          {
            name: 'limit',
            in: 'query',
            description:
              'Maximum tokens returned, clamped to [1, 100000]. Non-numeric, zero, and negative values fall back to the default.',
            schema: { type: 'integer', minimum: 1, maximum: 100000, default: 50000 },
          },
        ],
        responses: {
          '200': {
            description: 'Ranked tokens with totals.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TokensByChain' } } },
          },
          '400': {
            description:
              'Missing or syntactically invalid chainId — eip155 references must be numeric; chain 0 is asset-0.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/list/merged/{order}': {
      get: {
        tags: ['Token Endpoints'],
        summary: 'Merged token list across providers for one chain, using a named ordering',
        'x-example': '/list/merged/default?chainId=eip155-369',
        parameters: [
          {
            name: 'order',
            in: 'path',
            required: true,
            description: 'Named ordering (e.g. default) or an explicit order id.',
            schema: { type: 'string' },
          },
          {
            ...CHAIN_ID_QUERY_PARAM,
            required: true,
            description:
              'Chain to merge tokens for — prefixed form (eip155-369) or bare numeric (369). ' +
              'Required: the merged ordering query cannot complete across every chain at once.',
          },
          DECIMALS_QUERY_PARAM,
        ],
        responses: {
          ...TOKEN_LIST_RESPONSE,
          '400': {
            description: 'Missing chainId query parameter.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/list/{providerKey}': {
      get: {
        tags: ['Token Endpoints'],
        summary: "A provider's default token list (listKey omitted)",
        'x-example': '/list/pulsex',
        parameters: [PROVIDER_KEY_PARAM, CHAIN_ID_QUERY_PARAM, DECIMALS_QUERY_PARAM, EXTENSIONS_PARAM],
        responses: TOKEN_LIST_RESPONSE,
      },
    },
    '/list/{providerKey}/{listKey}': {
      get: {
        tags: ['Token Endpoints'],
        summary: 'A specific provider token list',
        description: 'Omitting the listKey segment (/list/{providerKey}) returns the provider default list.',
        'x-example': '/list/pulsex/extended?chainId=eip155-369',
        parameters: [PROVIDER_KEY_PARAM, LIST_KEY_PARAM, CHAIN_ID_QUERY_PARAM, DECIMALS_QUERY_PARAM, EXTENSIONS_PARAM],
        responses: TOKEN_LIST_RESPONSE,
      },
    },
    '/list/{providerKey}/{listKey}/{version}': {
      get: {
        tags: ['Token Endpoints'],
        summary: 'A specific versioned token list',
        'x-example': '/list/pulsex/extended/1.0.0',
        parameters: [
          PROVIDER_KEY_PARAM,
          LIST_KEY_PARAM,
          {
            name: 'version',
            in: 'path',
            required: true,
            description: 'Semantic version (e.g. 1.0.0).',
            schema: { type: 'string' },
          },
          CHAIN_ID_QUERY_PARAM,
          DECIMALS_QUERY_PARAM,
          EXTENSIONS_PARAM,
        ],
        responses: TOKEN_LIST_RESPONSE,
      },
    },
    '/image/{chainId}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Network / chain icon',
        description:
          'Resize and format-conversion query parameters work here too. A path extension on this route ' +
          'is a SOURCE filter, not a conversion: /image/eip155-369.png serves only a png source, and ' +
          '/image/eip155-369.webp responds 404 when no webp source exists — the opposite of the token ' +
          '.{ext} route, where the extension converts the output.',
        'x-example': '/image/eip155-369',
        parameters: [CHAIN_ID_PARAM, MODE_PARAM, ...RESIZE_PARAMS],
        responses: {
          ...IMAGE_RESPONSE,
          ...REDIRECT_RESPONSE,
        },
      },
    },
    '/image/{chainId}/{address}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Token image, priority-ordered by list ranking',
        'x-example': '/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?w=64&h=64&as=webp',
        parameters: [CHAIN_ID_PARAM, ADDRESS_PARAM, ...IMAGE_FILTER_PARAMS, ...RESIZE_PARAMS],
        responses: {
          ...IMAGE_RESPONSE,
          ...REDIRECT_RESPONSE,
        },
      },
    },
    '/image/{chainId}/{address}.{ext}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Token image converted to a specific format via path extension',
        description:
          'The extension converts the output, equivalent to ?as=. Requesting .svg when the token has ' +
          'no SVG source responds 404; extensions outside the supported set (e.g. .bmp) respond 406.',
        'x-example': '/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.webp',
        parameters: [
          CHAIN_ID_PARAM,
          ADDRESS_PARAM,
          {
            name: 'ext',
            in: 'path',
            required: true,
            description: 'Output format. SVG output requires an SVG source.',
            schema: { type: 'string', enum: ['png', 'webp', 'jpg', 'avif', 'svg'] },
          },
        ],
        responses: {
          ...IMAGE_RESPONSE,
          '406': {
            description: 'Unsupported output extension (e.g. .bmp).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/image/{order}/{chainId}/{address}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Token image with an explicit provider ordering',
        description: 'An unknown order name silently falls back to the default ordering.',
        'x-example': '/image/default/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
        parameters: [
          {
            name: 'order',
            in: 'path',
            required: true,
            description: 'Named ordering (e.g. default) or order id.',
            schema: { type: 'string' },
          },
          CHAIN_ID_PARAM,
          ADDRESS_PARAM,
          ...IMAGE_FILTER_PARAMS,
          ...RESIZE_PARAMS,
        ],
        responses: {
          ...IMAGE_RESPONSE,
          ...REDIRECT_RESPONSE,
        },
      },
    },
    '/image/fallback/{order}/{chainId}/{address}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Ordered image lookup that falls back to unordered',
        'x-example': '/image/fallback/default/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
        parameters: [
          {
            name: 'order',
            in: 'path',
            required: true,
            description: 'Named ordering tried first.',
            schema: { type: 'string' },
          },
          CHAIN_ID_PARAM,
          ADDRESS_PARAM,
          ...IMAGE_FILTER_PARAMS,
          ...RESIZE_PARAMS,
        ],
        responses: {
          ...IMAGE_RESPONSE,
          ...REDIRECT_RESPONSE,
        },
      },
    },
    '/image/direct/{imageHash}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Image by content hash — content-addressed access',
        'x-example': '/image/direct/048d63e01bc0c7079394113db00275c0001b679cd7b8749d17ee87c2efb32a78',
        parameters: [
          {
            name: 'imageHash',
            in: 'path',
            required: true,
            description:
              'Content hash from list/token logoURI fields. A bare hash serves the stored image; ' +
              'an extension suffix (e.g. {hash}.svg) is a source filter — 404 when the stored ' +
              'image is not of that type.',
            schema: { type: 'string' },
          },
          ...RESIZE_PARAMS,
        ],
        responses: IMAGE_RESPONSE,
      },
    },
    '/image/': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Batch lookup — first match across repeated i= candidates',
        'x-example': '/image/?i=eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
        parameters: [
          {
            name: 'i',
            in: 'query',
            required: true,
            description:
              'Candidate as chainId/address, optionally chainId/address/{orderId} where the third ' +
              'segment must be a 64-character hex order id — named orders (e.g. default) are ' +
              'rejected with 406. A bare chainId candidate (no address) serves that network icon. ' +
              'Repeatable; first hit wins.',
            schema: { type: 'string' },
          },
          ...IMAGE_FILTER_PARAMS,
          ...RESIZE_PARAMS,
        ],
        responses: {
          ...IMAGE_RESPONSE,
          ...REDIRECT_RESPONSE,
          '406': {
            description: 'Invalid candidate, or a third segment that is not a 64-character hex order id.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/sprite/{providerKey}/{listKey}': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Sprite sheet manifest (JSON) for a token list',
        'x-example': '/sprite/pulsex/extended?size=32&cols=10&limit=20',
        parameters: [
          PROVIDER_KEY_PARAM,
          LIST_KEY_PARAM,
          {
            name: 'size',
            in: 'query',
            description: 'Cell size in pixels.',
            schema: { type: 'integer', minimum: 16, maximum: 128, default: 32 },
          },
          {
            name: 'cols',
            in: 'query',
            description: 'Grid columns.',
            schema: { type: 'integer', minimum: 5, maximum: 50, default: 25 },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum tokens.',
            schema: { type: 'integer', minimum: 1, maximum: 2000, default: 500 },
          },
          {
            name: 'content',
            in: 'query',
            description: 'content=mixed inlines SVGs as data URIs.',
            schema: { type: 'string', enum: ['mixed'] },
          },
          { name: 'chainId', in: 'query', description: 'Filter to one chain.', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Manifest mapping token keys to grid coordinates (or inline data URIs).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SpriteManifest' } } },
          },
          '404': {
            description: 'Unknown provider or list.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/sprite/{providerKey}/{listKey}/sheet': {
      get: {
        tags: ['Image Endpoints'],
        summary: 'Rendered sprite sheet image (WebP) — same parameters as the manifest',
        'x-example': '/sprite/pulsex/extended/sheet?size=32&cols=10&limit=20',
        parameters: [
          PROVIDER_KEY_PARAM,
          LIST_KEY_PARAM,
          {
            name: 'size',
            in: 'query',
            description: 'Cell size in pixels.',
            schema: { type: 'integer', minimum: 16, maximum: 128, default: 32 },
          },
          {
            name: 'cols',
            in: 'query',
            description: 'Grid columns.',
            schema: { type: 'integer', minimum: 5, maximum: 50, default: 25 },
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum tokens.',
            schema: { type: 'integer', minimum: 1, maximum: 2000, default: 500 },
          },
        ],
        responses: {
          '200': {
            description: 'WebP sheet with x-sprite-* metadata headers.',
            content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
          },
          '204': { description: 'No raster tokens to render.' },
          '404': {
            description: 'Unknown provider or list.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/lists/submit': {
      post: {
        tags: ['Submissions'],
        summary: 'Submit a token list URL for inclusion',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'name', 'submittedBy'],
                properties: {
                  url: { type: 'string', description: 'URL serving a Uniswap-style token list JSON.' },
                  name: { type: 'string' },
                  submittedBy: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description:
              'Submission accepted (new submissions start pending). Resubmitting an existing URL updates ' +
              'name/description/submittedBy and returns the existing status (it is not reset to pending).',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    status: { type: 'string' },
                    providerKey: { type: 'string' },
                    listKey: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Missing fields, disallowed URL (non-http(s) or private address), or not a token list.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/lists/submissions': {
      get: {
        tags: ['Submissions'],
        summary: 'List submissions, optionally filtered by status',
        'x-example': '/api/lists/submissions?status=approved',
        parameters: [{ name: 'status', in: 'query', description: 'Filter by status.', schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Submission array.',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Submission' } } },
            },
          },
        },
      },
    },
    '/api/lists/submissions/approved': {
      get: {
        tags: ['Submissions'],
        summary: 'Approved submissions feed for the collector (admin token required)',
        description:
          'Returns approved submissions mapped for the collection pipeline. Side effect: auto-mode image ' +
          'transitions (auto→save/link based on subscriber count and access recency) are persisted to the ' +
          'database during this request.',
        'x-example': '/api/lists/submissions/approved',
        security: [{ adminBearer: [] }],
        responses: {
          '200': {
            description: 'Approved submissions mapped for the collector.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      providerKey: { type: 'string' },
                      listKey: { type: 'string' },
                      imageMode: { type: 'string', enum: ['link', 'save'] },
                      lastContentHash: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Missing or invalid admin bearer token (401 also when ADMIN_TOKEN is unset).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/lists/submissions/{id}': {
      patch: {
        tags: ['Submissions'],
        summary: 'Update a submission status / image mode (admin token required)',
        security: [{ adminBearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'stale'] },
                  imageMode: { type: 'string', enum: ['link', 'save', 'auto'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated submission.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Submission' } } },
          },
          '400': {
            description: 'No recognized fields to update, or a status/imageMode value outside the allowed enums.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '401': {
            description: 'Missing or invalid admin bearer token (401 also when ADMIN_TOKEN is unset).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '404': {
            description: 'Submission not found.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/images/submit': {
      post: {
        tags: ['Submissions'],
        summary: 'Submit a token image as a base64 data URI (max 512KB)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['chainId', 'address', 'image', 'submittedBy'],
                properties: {
                  chainId: { type: 'string', description: 'Prefixed or bare chain id.' },
                  address: { type: 'string' },
                  image: { type: 'string', description: 'data:image/...;base64,... (max 512KB)' },
                  submittedBy: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Stored image.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { imageHash: { type: 'string' }, imageUrl: { type: 'string' } },
                },
              },
            },
          },
          '400': {
            description: 'Missing fields, invalid data URI, or decoded image over the 512 KB limit.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '413': {
            description:
              'Request body exceeds the 1 MB JSON parser limit (the decoded image limit itself is 512 KB; ' +
              'base64 encoding inflates payloads by about a third).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/github/token': {
      post: {
        tags: ['Service'],
        summary: 'GitHub OAuth code-for-token exchange proxy (used by the studio publish flow)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': {
            description: 'Access token.',
            content: {
              'application/json': { schema: { type: 'object', properties: { access_token: { type: 'string' } } } },
            },
          },
          '400': {
            description: 'Missing code or exchange rejected.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '502': {
            description:
              'GitHub responded with a non-OK status, or the exchange request to GitHub failed ' +
              '(network error). Details are logged server-side, not returned.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '503': {
            description: 'OAuth not configured on this deployment.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      Token: {
        type: 'object',
        properties: {
          chainId: {
            type: 'integer',
            description:
              'Bare numeric chain id (token-list standard). Ambiguous across namespaces — 501 is ' +
              'both Solana and any eip155 chain numbered 501 — so read chainIdentifier when the ' +
              'namespace matters.',
          },
          chainIdentifier: {
            type: 'string',
            description:
              'Full CAIP-2 identifier the token is stored under (eip155-369, solana-501). Always ' +
              'present on served tokens; it is what disambiguates chainId.',
          },
          address: { type: 'string' },
          name: { type: 'string' },
          symbol: { type: 'string' },
          decimals: { type: 'integer' },
          logoURI: { type: 'string' },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'provider/list keys that include this token, priority order.',
          },
          extensions: { type: 'object', description: 'Present when requested via ?extensions=.' },
        },
      },
      TokenList: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          logoURI: { type: ['string', 'null'], description: 'List logo; null for merged lists.' },
          timestamp: { type: 'string', format: 'date-time' },
          version: {
            type: 'object',
            properties: { major: { type: 'integer' }, minor: { type: 'integer' }, patch: { type: 'integer' } },
          },
          tokens: { type: 'array', items: { $ref: '#/components/schemas/Token' } },
        },
      },
      TokensByChain: {
        type: 'object',
        properties: {
          chainId: { type: 'integer', description: 'Bare numeric chain id.' },
          chainIdentifier: { type: 'string', description: 'Prefixed identifier (eip155-369).' },
          total: { type: 'integer' },
          tokens: { type: 'array', items: { $ref: '#/components/schemas/Token' } },
        },
      },
      ListInfo: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          default: { type: 'boolean' },
          providerKey: { type: 'string' },
          chainId: { type: 'string', description: 'Prefixed identifier (eip155-369).' },
          chainType: { type: 'string', description: 'Chain family (e.g. evm).' },
          major: { type: 'integer' },
          minor: { type: 'integer' },
          patch: { type: 'integer' },
        },
      },
      Network: {
        type: 'object',
        properties: {
          networkId: { type: 'string' },
          type: { type: 'string' },
          chainId: { type: 'string', description: 'Bare chain id as a string.' },
          chainIdentifier: { type: 'string', description: 'Prefixed identifier (eip155-1).' },
          name: {
            type: ['string', 'null'],
            description:
              'Display name from the ethereum-lists registry ("Ethereum Mainnet"). Null when no collector had a name for the chain; clients should fall back to their own map.',
          },
          title: {
            type: ['string', 'null'],
            description:
              'The registry\'s longer prose label ("Ethereum Testnet Sepolia"), on the ~11% of chains that ship one. Not a display field — use name. Provided because the registry publishes no testnet flag, and a testnet named after a codename ("Adiri") states what it is only here.',
          },
          imageHash: { type: ['string', 'null'] },
        },
      },
      ChainStat: {
        type: 'object',
        properties: {
          chainId: { type: 'string', description: 'Bare chain id as a string.' },
          chainIdentifier: { type: 'string' },
          count: { type: 'integer' },
        },
      },
      SpriteManifest: {
        type: 'object',
        properties: {
          spriteUrl: { type: 'string' },
          size: { type: 'integer' },
          cols: { type: 'integer' },
          rows: { type: 'integer' },
          rasterCount: { type: 'integer' },
          svgCount: { type: 'integer' },
          count: { type: 'integer' },
          tokens: {
            type: 'object',
            description: 'chainId-address → [col, row] grid coordinates, or an inline SVG data URI when content=mixed.',
          },
        },
      },
      Submission: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          submittedBy: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'stale'] },
          providerKey: { type: 'string' },
          listKey: { type: 'string' },
          imageMode: { type: 'string', enum: ['link', 'save', 'auto'] },
          failCount: { type: 'integer' },
          subscriberCount: { type: 'integer' },
          lastFetchedAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    securitySchemes: {
      adminBearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'Admin token (ADMIN_TOKEN environment variable on the server) for moderation endpoints.',
      },
    },
  },
} as const

export type OpenApiDocument = typeof openapi
