# gib.show on the altar-prod `gib` tenant

gib.show runs production and staging side by side under rootless Docker as the
user `gib` on altar-prod. The deploy lives in `deploy/altar/`:

| File | What it is |
|---|---|
| `compose.yml` | Eight services: `postgres-`, `browser-`, `server-`, `collector-` for each environment |
| `gib.env.tpl` | 1Password references for every secret; no values |
| `deploy.sh` | Checks out the branches on the box, writes the secrets, builds, starts, waits for health |

Nothing on the box is edited by hand. Change these files and run the deploy.

## The tenant

- **Login:** `ssh gib-altar`, port 2222, user `gib`. The 1Password item
  "gib-show tenant ssh" (vault `valve`) holds the key; the 1Password SSH agent signs.
  If the workstation has no `gib-altar` alias, export the public half and pass a config
  file. The private half never leaves 1Password.
  ```
  op read "op://valve/gib-show tenant ssh/public key" > /tmp/gib_altar.pub
  cat > /tmp/gib_ssh_config <<EOF
  Host gib-altar
    HostName 138.201.31.177
    Port 2222
    User gib
    IdentitiesOnly yes
    IdentityFile /tmp/gib_altar.pub
  EOF
  export GIB_SSH_OPTIONS="-F /tmp/gib_ssh_config"
  ```
- **Limits:** the whole `gib` slice gets 20 GiB of memory (no swap) and 6 CPU threads.
  The container memory limits add up to 18 GiB (see the header of `compose.yml`), so a
  runaway container is killed at its own limit, and image builds keep about 2 GiB.
- **Storage:** everything is under `/srv/gib`, a dedicated disk with no redundancy.
  Docker's data root is `/srv/gib/docker`, so all four named volumes (two databases,
  two browser caches) and all images live there. Source checkouts are in
  `/srv/gib/src/{production,staging}`, and the app directory is `/srv/gib/app`.
- **Ports:** only the servers publish, on loopback: production `127.0.0.1:3100`,
  staging `127.0.0.1:3101`. Nothing listens publicly.

## Deploy

```
deploy/altar/deploy.sh             # both environments
deploy/altar/deploy.sh staging     # one environment
```

Production builds from `master`, staging from `staging`. The script runs `op inject`
on the workstation and streams the result into `~/app/.env` on the box (mode 600). It
then proves the file exists by mode, owner, size and line count, never by contents.
The server applies database migrations itself when it starts.

## Secrets

All secrets live in the 1Password item "gib-show app" (vault `valve`). To add one:
1. Add a field with `env -u OP_SERVICE_ACCOUNT_TOKEN op item edit`, from the owner's
   session.
2. Add a reference line to `gib.env.tpl`.
3. Name it as `${NAME}` under the `environment:` of each service that reads it in
   `compose.yml`, and only those services. There is no `env_file`, so a staging
   container never receives a production secret.
4. Deploy.

Never run `docker compose config` without `--no-interpolate`, because it prints the
interpolated secrets. To identify a value, print six characters and a length.

The database passwords and browser tokens were generated for this box. The API keys,
`ADMIN_TOKEN`, the BNB Chain RPC endpoints and staging's GitLab secret were copied
from Railway.

## Operating

All commands run on the box, in `~/app`, with `DOCKER_CONTEXT=rootless` (the default
context there):

```
docker compose ps                               # health of every service
docker compose logs -f --tail=100 collector-production
docker compose exec postgres-production psql -U gibassets gibassets
curl -s http://127.0.0.1:3100/health            # production
curl -s http://127.0.0.1:3101/health            # staging
```

The collectors loop: one pass, then a one-hour pause. Staging starts half an hour
later than production, so their heavy passes rarely overlap.

**Restart test:** `loginctl terminate-user gib` stops the user manager. Lingering
starts it again, and Docker's `restart: unless-stopped` brings every container back.

## Decisions waiting for the owner

### 1. Public ingress

Nothing is reachable from outside yet. The DNS records for gib.show and
staging.gib.show still point at Railway. The flip happens once the new databases have
caught up. These are the options:

| Option | What it takes | Root or firewall change | Notes |
|---|---|---|---|
| **A. Cloudflare Tunnel** (recommended) | A `cloudflared` container in this compose project, run by `gib`. It opens outbound connections to Cloudflare and forwards to 127.0.0.1:3100/3101. The tunnel token goes in "gib-show app". | None. No inbound port, ufw stays default-deny. | The DNS flip becomes "point the record at the tunnel". The existing Cloudflare cache rules keep working. Cloudflare sees the plain loopback hop, so no origin certificate is needed. |
| B. The host's Caddy | A site block on the box's shared Caddy, proxying to the loopback ports, with a Cloudflare origin certificate. | Yes: root edits the shared Caddy configuration. | It shares a process with other tenants, and every gib.show change then needs root. |
| C. A rootless Caddy on a high port | Caddy in this compose project on, for example, 8443, with Cloudflare rewriting the origin port. | Yes: a ufw rule and a Hetzner Robot firewall rule. | It opens an inbound port, which this tenant was built to avoid. |

### 2. Off-box backups

`/srv/gib` has no redundancy, and a rebuilt database loses list submissions, custom
list orders and images whose source has gone. Proposal:
- **Schedule:** a user-level systemd timer (no root) runs nightly. For each database,
  it runs `pg_dump --format=custom` inside the running Postgres container and streams
  the output into `restic`.
- **Target:** a Hetzner Storage Box (BX11: 1 TB, a few euros a month), reached over
  SFTP. Restic deduplicates, so most image bytes are stored once across nights.
- **Retention:** 7 daily, 4 weekly, 6 monthly, applied with `restic forget --prune`.
- **Restore test:** a weekly timer restores the newest snapshot into a throwaway
  Postgres container and compares row counts for every table with the live database.
  A mismatch fails the unit, and a failed unit is reported.
- **Secrets:** the Storage Box SSH key and the restic password become new fields in
  "gib-show app", delivered by the same `op inject` route.

Neither is built. Each waits for a decision.
