import { Router, json } from 'express'

export const router = Router()

/**
 * Thin proxy for GitHub OAuth token exchange.
 * GitHub's token endpoint does not support CORS, so the SPA
 * sends the auth code here and we exchange it server-side.
 */
router.post('/token', json(), async (req, res) => {
  const { code } = req.body
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing code parameter' })
    return
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'GitHub OAuth not configured' })
    return
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    if (!response.ok) {
      res.status(502).json({ error: `GitHub returned ${response.status}` })
      return
    }

    const data = await response.json()

    if (data.error) {
      res.status(400).json({ error: data.error, error_description: data.error_description })
      return
    }

    res.json({ access_token: data.access_token })
  } catch (err) {
    res.status(502).json({ error: 'Failed to exchange token', details: (err as Error).message })
  }
})
