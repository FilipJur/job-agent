# Deployment (home Mac, OrbStack)

Runs on the home Mac (M1): `web` serves the UI, `daily` collects + scores every morning at 06:30 via launchd.

## Prerequisites

- OrbStack (provides `docker` + `docker compose`), git.
- `.env` in the repo root with `OPENCODE_GO_API_KEY` (see `.env.example` for all keys).

## First start

```sh
docker compose up -d web
docker compose run --rm daily
bun run agencies:seed
```

`agencies:seed` runs on the host (one-off); the DB lives in `data/jobs.db` and is shared with containers via volume.

## Schedule install

Check the docker path first (`which docker`); OrbStack usually provides
`/usr/local/bin/docker`. If the path differs, replace `/usr/local/bin/docker`
in the plist with the actual path.

Replace `__REPO__` with the checkout path (`/Users/filip/projects/job-agent`):

```sh
sed 's#__REPO__#/Users/filip/projects/job-agent#g' deploy/cz.jobagent.daily.plist > ~/Library/LaunchAgents/cz.jobagent.daily.plist
launchctl load ~/Library/LaunchAgents/cz.jobagent.daily.plist
launchctl list | grep cz.jobagent.daily
```

Uninstall:

```sh
launchctl unload ~/Library/LaunchAgents/cz.jobagent.daily.plist
rm ~/Library/LaunchAgents/cz.jobagent.daily.plist
```

Logs: `data/daily.log`.

## Keeping the Mac awake

Scheduled runs need the Mac awake at 06:30 with OrbStack running:

```sh
sudo pmset -c sleep 0
sudo pmset repeat wakeorpoweron MTWRFSU 06:25:00
```

Keep the Mac on the power adapter; `pmset -g sched` shows the wake schedule.

## Access

- This Mac: `http://localhost:3000`
- LAN: `http://<mac-ip>:3000` (compose publishes port 3000; `HOST=0.0.0.0` in compose for `web`).
- Via Tailscale: `http://<tailscale-hostname>:3000`. No public exposure, no auth.

## Update

```sh
git pull && docker compose build
docker compose up -d web
```

## Backup

```sh
sqlite3 data/jobs.db ".backup 'data/jobs.db.$(date +%F).bak'"
```

Back up `data/jobs.db` before updates; restore by stopping `web` and copying the backup back.
