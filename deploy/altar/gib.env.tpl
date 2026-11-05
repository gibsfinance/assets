# gib.show secrets for the altar-prod `gib` tenant. References only, no values.
# deploy.sh renders this with `op inject` straight into ~/app/.env on the box.
# Every field lives in the 1Password item "gib-show app" (vault valve).

# Shared by production and staging. Third-party API keys only: a leak from staging
# costs quota, not access to production.
COINGECKO_API_KEY={{ op://valve/gib-show app/coingecko_api_key }}
ETHERSCAN_API_KEY={{ op://valve/gib-show app/etherscan_api_key }}

# Ingress (Cloudflare Tunnel "gib-show", shared by both environments)
CLOUDFLARE_TUNNEL_TOKEN={{ op://valve/gib-show app/cloudflare_tunnel_token }}

# Production
PRODUCTION_ADMIN_TOKEN={{ op://valve/gib-show app/production_admin_token }}
PRODUCTION_POSTGRES_PASSWORD={{ op://valve/gib-show app/production_postgres_password }}
PRODUCTION_BROWSER_TOKEN={{ op://valve/gib-show app/production_browser_token }}
PRODUCTION_RPC_56={{ op://valve/gib-show app/production_rpc_56 }}

# Staging
STAGING_ADMIN_TOKEN={{ op://valve/gib-show app/staging_admin_token }}
STAGING_POSTGRES_PASSWORD={{ op://valve/gib-show app/staging_postgres_password }}
STAGING_BROWSER_TOKEN={{ op://valve/gib-show app/staging_browser_token }}
STAGING_RPC_56={{ op://valve/gib-show app/staging_rpc_56 }}
STAGING_GITLAB_OAUTH_CLIENT_SECRET={{ op://valve/gib-show app/staging_gitlab_oauth_client_secret }}
