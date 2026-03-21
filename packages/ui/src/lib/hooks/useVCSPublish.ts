import { useState, useCallback } from 'react'
import type { LocalList } from './useLocalLists'

/** Pluggable interface for version control system publishing */
export interface VCSPublisher {
  name: string
  icon: string
  /** Initiate auth flow, return access token */
  authorize(): Promise<string>
  /** Check if already authorized */
  isAuthorized(): boolean
  /** Create or update a repo with the token list */
  publish(list: LocalList, options: PublishOptions): Promise<PublishResult>
}

export interface PublishOptions {
  repoName?: string
  commitMessage?: string
  branch?: string
}

export interface PublishResult {
  repoUrl: string
  commitUrl?: string
  fileUrl?: string
}

/** Convert a LocalList to Uniswap Token List standard JSON */
export function toTokenListJson(list: LocalList): string {
  const tokenList = {
    name: list.name,
    timestamp: new Date().toISOString(),
    version: { major: 1, minor: 0, patch: 0 },
    tokens: list.tokens.map((t) => ({
      chainId: t.chainId,
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
      ...(t.imageUri ? { logoURI: t.imageUri } : {}),
    })),
  }
  return JSON.stringify(tokenList, null, 2)
}

const TOKEN_STORAGE_KEY = 'gib-vcs-tokens'

function getStoredTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function storeToken(provider: string, token: string): void {
  const tokens = getStoredTokens()
  tokens[provider] = token
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
}

function getToken(provider: string): string | null {
  return getStoredTokens()[provider] || null
}

/** GitHub publisher — uses server proxy for OAuth token exchange */
export function createGitHubPublisher(serverBaseUrl: string): VCSPublisher {
  const GITHUB_CLIENT_ID = 'Ov23liXXXXXXXXXXXXXX' // TODO: replace with real client ID

  return {
    name: 'GitHub',
    icon: 'fab fa-github',

    async authorize(): Promise<string> {
      // Standard OAuth web flow — redirect to GitHub, server proxy exchanges code
      const state = crypto.randomUUID()
      sessionStorage.setItem('github-oauth-state', state)

      const redirectUri = `${window.location.origin}${window.location.pathname}`
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=public_repo&state=${state}`

      window.location.href = authUrl
      // This will redirect — the callback handler completes the flow
      return '' // unreachable
    },

    isAuthorized(): boolean {
      return !!getToken('github')
    },

    async publish(list: LocalList, options: PublishOptions = {}): Promise<PublishResult> {
      const token = getToken('github')
      if (!token) throw new Error('Not authorized with GitHub')

      const repoName = options.repoName || `token-list-${list.name.toLowerCase().replace(/\s+/g, '-')}`
      const branch = options.branch || 'main'
      const message = options.commitMessage || `Update ${list.name} token list`

      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }

      // Get or create repo
      let repoUrl: string
      const userRes = await fetch('https://api.github.com/user', { headers })
      if (!userRes.ok) throw new Error('GitHub auth failed — please re-authorize')
      const user = await userRes.json()

      const repoRes = await fetch(`https://api.github.com/repos/${user.login}/${repoName}`, { headers })
      if (repoRes.status === 404) {
        // Create repo
        const createRes = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: repoName,
            description: `Token list: ${list.name}`,
            auto_init: true,
          }),
        })
        if (!createRes.ok) throw new Error(`Failed to create repo: ${createRes.status}`)
        const repo = await createRes.json()
        repoUrl = repo.html_url
      } else if (repoRes.ok) {
        const repo = await repoRes.json()
        repoUrl = repo.html_url
      } else {
        throw new Error(`GitHub API error: ${repoRes.status}`)
      }

      // Get current file SHA (for update)
      const filePath = 'tokenlist.json'
      const fileContent = toTokenListJson(list)
      const contentBase64 = btoa(unescape(encodeURIComponent(fileContent)))

      const existingFile = await fetch(
        `https://api.github.com/repos/${user.login}/${repoName}/contents/${filePath}?ref=${branch}`,
        { headers },
      )
      const sha = existingFile.ok ? (await existingFile.json()).sha : undefined

      // Create or update file
      const putRes = await fetch(
        `https://api.github.com/repos/${user.login}/${repoName}/contents/${filePath}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message,
            content: contentBase64,
            branch,
            ...(sha ? { sha } : {}),
          }),
        },
      )
      if (!putRes.ok) throw new Error(`Failed to push file: ${putRes.status}`)
      const putData = await putRes.json()

      return {
        repoUrl,
        commitUrl: putData.commit?.html_url,
        fileUrl: putData.content?.html_url,
      }
    },
  }
}

/** Handle OAuth callback — call this on page load to complete the flow */
export function handleOAuthCallback(serverBaseUrl: string): boolean {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  if (!code || !state) return false

  const storedState = sessionStorage.getItem('github-oauth-state')
  if (state !== storedState) {
    console.error('OAuth state mismatch')
    return false
  }

  sessionStorage.removeItem('github-oauth-state')

  // Exchange code for token via server proxy
  fetch(`${serverBaseUrl}/api/github/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.access_token) {
        storeToken('github', data.access_token)
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname + window.location.hash)
      }
    })
    .catch(console.error)

  return true
}

/** Hook for VCS publishing */
export function useVCSPublish() {
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const publish = useCallback(async (publisher: VCSPublisher, list: LocalList, options?: PublishOptions) => {
    setIsPublishing(true)
    setError(null)
    setPublishResult(null)
    try {
      if (!publisher.isAuthorized()) {
        await publisher.authorize()
        return // redirect happens
      }
      const result = await publisher.publish(list, options || {})
      setPublishResult(result)
      return result
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsPublishing(false)
    }
  }, [])

  return { publish, isPublishing, publishResult, error }
}
