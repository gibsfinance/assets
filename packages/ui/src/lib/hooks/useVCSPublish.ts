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

/** 30 days in milliseconds */
const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

interface StoredToken {
  token: string
  storedAt: number
}

function getStoredTokens(): Record<string, StoredToken | string> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function storeToken(provider: string, token: string): void {
  const tokens = getStoredTokens()
  tokens[provider] = { token, storedAt: Date.now() }
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
}

function getToken(provider: string): string | null {
  const entry = getStoredTokens()[provider]
  if (!entry) return null

  // Handle legacy entries stored as plain strings (no expiry info)
  if (typeof entry === 'string') return entry

  if (Date.now() - entry.storedAt > TOKEN_MAX_AGE_MS) {
    // Token expired — remove it
    const tokens = getStoredTokens()
    delete tokens[provider]
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
    return null
  }
  return entry.token
}

/** GitHub publisher — uses server proxy for OAuth token exchange */
export function createGitHubPublisher(serverBaseUrl: string): VCSPublisher {
  const GITHUB_CLIENT_ID = (typeof process !== 'undefined' && process.env?.VITE_GITHUB_CLIENT_ID) || ''

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

// ---------------------------------------------------------------------------
// GitLab publisher
// ---------------------------------------------------------------------------

export interface GitLabPublisherOptions {
  /** GitLab instance URL (default: https://gitlab.com) */
  serverUrl?: string
  /** OAuth client ID from GitLab application settings */
  clientId: string
  /** Server proxy URL for OAuth token exchange */
  serverBaseUrl: string
}

export function createGitLabPublisher(options: GitLabPublisherOptions): VCSPublisher {
  const serverUrl = (options.serverUrl || 'https://gitlab.com').replace(/\/$/, '')
  const apiUrl = `${serverUrl}/api/v4`

  return {
    name: serverUrl === 'https://gitlab.com' ? 'GitLab' : `GitLab (${new URL(serverUrl).hostname})`,
    icon: 'fab fa-gitlab',

    async authorize(): Promise<string> {
      const state = crypto.randomUUID()
      sessionStorage.setItem('gitlab-oauth-state', state)

      const redirectUri = `${window.location.origin}${window.location.pathname}`
      const authUrl = `${serverUrl}/oauth/authorize?client_id=${options.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=api&state=${state}`

      window.location.href = authUrl
      return ''
    },

    isAuthorized(): boolean {
      return !!getToken('gitlab')
    },

    async publish(list: LocalList, publishOptions: PublishOptions = {}): Promise<PublishResult> {
      const token = getToken('gitlab')
      if (!token) throw new Error('Not authorized with GitLab')

      const headers = {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json',
      }

      const repoName = publishOptions.repoName || `token-list-${list.name.toLowerCase().replace(/\s+/g, '-')}`
      const branch = publishOptions.branch || 'main'
      const message = publishOptions.commitMessage || `Update ${list.name} token list`

      // Get current user
      const userRes = await fetch(`${apiUrl}/user`, { headers })
      if (!userRes.ok) throw new Error('GitLab auth failed — please re-authorize')
      const user = await userRes.json()

      const projectPath = encodeURIComponent(`${user.username}/${repoName}`)

      // Get or create project
      let repoUrl: string
      const projectRes = await fetch(`${apiUrl}/projects/${projectPath}`, { headers })
      if (projectRes.status === 404) {
        const createRes = await fetch(`${apiUrl}/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: repoName,
            description: `Token list: ${list.name}`,
            initialize_with_readme: true,
            default_branch: branch,
          }),
        })
        if (!createRes.ok) throw new Error(`Failed to create project: ${createRes.status}`)
        const project = await createRes.json()
        repoUrl = project.web_url
      } else if (projectRes.ok) {
        const project = await projectRes.json()
        repoUrl = project.web_url
      } else {
        throw new Error(`GitLab API error: ${projectRes.status}`)
      }

      // Create or update file via Repository Files API
      const filePath = 'tokenlist.json'
      const fileContent = toTokenListJson(list)
      const encodedFilePath = encodeURIComponent(filePath)

      // Check if file exists
      const existingRes = await fetch(
        `${apiUrl}/projects/${projectPath}/repository/files/${encodedFilePath}?ref=${branch}`,
        { headers },
      )
      const method = existingRes.ok ? 'PUT' : 'POST'

      const fileRes = await fetch(
        `${apiUrl}/projects/${projectPath}/repository/files/${encodedFilePath}`,
        {
          method,
          headers,
          body: JSON.stringify({
            branch,
            content: fileContent,
            commit_message: message,
          }),
        },
      )
      if (!fileRes.ok) throw new Error(`Failed to push file: ${fileRes.status}`)

      return {
        repoUrl,
        fileUrl: `${repoUrl}/-/blob/${branch}/${filePath}`,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Gitea publisher
// ---------------------------------------------------------------------------

export interface GiteaPublisherOptions {
  /** Gitea instance URL (e.g., https://gitea.example.com) */
  serverUrl: string
  /** OAuth client ID (or personal access token for simpler auth) */
  clientId?: string
  /** Server proxy URL for OAuth token exchange */
  serverBaseUrl?: string
}

export function createGiteaPublisher(options: GiteaPublisherOptions): VCSPublisher {
  const serverUrl = options.serverUrl.replace(/\/$/, '')
  const apiUrl = `${serverUrl}/api/v1`

  return {
    name: `Gitea (${new URL(serverUrl).hostname})`,
    icon: 'fas fa-code-branch',

    async authorize(): Promise<string> {
      if (options.clientId) {
        // OAuth flow
        const state = crypto.randomUUID()
        sessionStorage.setItem('gitea-oauth-state', state)

        const redirectUri = `${window.location.origin}${window.location.pathname}`
        const authUrl = `${serverUrl}/login/oauth/authorize?client_id=${options.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=repo&state=${state}`

        window.location.href = authUrl
        return ''
      }
      // No client ID — prompt for personal access token
      const token = prompt('Enter your Gitea personal access token:')
      if (!token) throw new Error('Authorization cancelled')
      storeToken('gitea', token)
      return token
    },

    isAuthorized(): boolean {
      return !!getToken('gitea')
    },

    async publish(list: LocalList, publishOptions: PublishOptions = {}): Promise<PublishResult> {
      const token = getToken('gitea')
      if (!token) throw new Error('Not authorized with Gitea')

      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }

      const repoName = publishOptions.repoName || `token-list-${list.name.toLowerCase().replace(/\s+/g, '-')}`
      const branch = publishOptions.branch || 'main'
      const message = publishOptions.commitMessage || `Update ${list.name} token list`

      // Get current user
      const userRes = await fetch(`${apiUrl}/user`, { headers })
      if (!userRes.ok) throw new Error('Gitea auth failed — please re-authorize')
      const user = await userRes.json()

      // Get or create repo
      let repoUrl: string
      const repoRes = await fetch(`${apiUrl}/repos/${user.login}/${repoName}`, { headers })
      if (repoRes.status === 404) {
        const createRes = await fetch(`${apiUrl}/user/repos`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: repoName,
            description: `Token list: ${list.name}`,
            auto_init: true,
            default_branch: branch,
          }),
        })
        if (!createRes.ok) throw new Error(`Failed to create repo: ${createRes.status}`)
        const repo = await createRes.json()
        repoUrl = repo.html_url
      } else if (repoRes.ok) {
        const repo = await repoRes.json()
        repoUrl = repo.html_url
      } else {
        throw new Error(`Gitea API error: ${repoRes.status}`)
      }

      // Create or update file via Contents API (Gitea mirrors GitHub API)
      const filePath = 'tokenlist.json'
      const fileContent = toTokenListJson(list)
      const contentBase64 = btoa(unescape(encodeURIComponent(fileContent)))

      const existingFile = await fetch(
        `${apiUrl}/repos/${user.login}/${repoName}/contents/${filePath}?ref=${branch}`,
        { headers },
      )
      const sha = existingFile.ok ? (await existingFile.json()).sha : undefined

      const putRes = await fetch(
        `${apiUrl}/repos/${user.login}/${repoName}/contents/${filePath}`,
        {
          method: sha ? 'PUT' : 'POST',
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
        fileUrl: putData.content?.html_url,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// OAuth callback handler
// ---------------------------------------------------------------------------

/**
 * Handle OAuth callback — call this on page load to complete the flow.
 * Detects which provider the callback is for based on stored session state.
 */
export function handleOAuthCallback(serverBaseUrl: string): boolean {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  if (!code || !state) return false

  // Detect which provider this callback belongs to
  type Provider = { key: string; storageKey: string; endpoint: string }
  const providers: Provider[] = [
    { key: 'github', storageKey: 'github-oauth-state', endpoint: '/api/github/token' },
    { key: 'gitlab', storageKey: 'gitlab-oauth-state', endpoint: '/api/gitlab/token' },
    { key: 'gitea', storageKey: 'gitea-oauth-state', endpoint: '/api/gitea/token' },
  ]

  const matched = providers.find((p) => sessionStorage.getItem(p.storageKey) === state)
  if (!matched) {
    console.error('OAuth state mismatch — no matching provider')
    return false
  }

  sessionStorage.removeItem(matched.storageKey)

  // Exchange code for token via server proxy
  fetch(`${serverBaseUrl}${matched.endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.access_token) {
        storeToken(matched.key, data.access_token)
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
