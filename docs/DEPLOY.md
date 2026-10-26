# Deployment (Docker-first, any Mac)

Everything runs in Docker; the host needs only OrbStack (or Docker Desktop), git and the `.env` file. The same commands work on this Mac and on the old home Mac. All state lives in `data/` (database, live profile, HTTP cache, logs); moving to another Mac means moving the checkout plus `data/` and `.env`.

- `web`: the UI on port 3000, restarts with Docker.
- `cli`: one-off commands. `docker compose run --rm cli` runs `daily` (agencies seed + collect + score); `docker compose run --rm cli <script> [args]` runs any other script.

## First start

```sh
git clone https://github.com/FilipJur/job-agent.git && cd job-agent
cp /path/to/.env .env            # OPENCODE_GO_API_KEY (see .env.example)
docker compose build
docker compose up -d web         # http://localhost:3000
docker compose run --rm cli      # first daily run: ~10 min collect, then scoring
```

Then open the **Profil** tab and adjust the profile; the next run re-scores everything under it.

## Daily schedule

```sh
deploy/schedule.sh install       # launchd, every day at 06:30; logs in data/daily.log
deploy/schedule.sh status
deploy/schedule.sh uninstall
```

The script fills in this checkout's path and the local `docker` path, so it is the same command on every Mac. Docker (OrbStack) must be running at that time. If the Mac sleeps at 06:30, launchd starts the missed run at the next wake; a run within 20 h of the previous one skips the sources.

Always-on home Mac only (not needed on a laptop): keep it on power and awake at 06:30:

```sh
sudo pmset -c sleep 0
sudo pmset repeat wakeorpoweron MTWRFSU 06:25:00
```

## Useful commands

```sh
docker compose run --rm cli daily --force      # collect again within 20 h
docker compose run --rm cli score              # only (re-)score, e.g. after a profile change
docker compose run --rm cli score --limit 5    # quick test
docker compose logs -f web
```

## Profil

The scoring profile is user data in `data/profile.md`. On first use it is created from the committed template `profile.md`. Edit it in the Profil tab or with any editor; no rebuild needed.

## Access

- This Mac: `http://localhost:3000`
- LAN: `http://<mac-ip>:3000`
- Tailscale: `http://<tailscale-hostname>:3000`. No public exposure, no auth.

## Update

```sh
git pull && docker compose build && docker compose up -d web
```

## Move to another Mac

1. Stop here: `deploy/schedule.sh uninstall && docker compose down`.
2. Back up: `sqlite3 data/jobs.db ".backup 'data/jobs.db.bak'"`, then copy the checkout's `data/` and `.env` to the other Mac.
3. There: "First start" without the first `cli` run (the data is already there), then `deploy/schedule.sh install`.

## Backup

```sh
sqlite3 data/jobs.db ".backup 'data/jobs.db.$(date +%F).bak'"
```
