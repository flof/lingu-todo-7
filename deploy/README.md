# Deploying LinguTodo7

Expected target: a Ubuntu VPS with nginx, certbot and docker.

Replace <DOMAINNAME> with your real domain name.

## First time

1. Get the code onto the server and build:

   ```sh
   ssh you@your-vps
   git clone <repo> /srv/lingutodo7     # or copy the directory up
   cd /srv/lingutodo7
   docker compose up -d --build
   ```

2. Confirm it is up on the loopback port only:

   ```sh
   curl -s localhost:8090/api/health        # {"ok":true}
   docker compose logs --tail=20 app
   ```

   The log contains a **first invite** link. Keep it for step 5.

3. Add the nginx server block and certificates:

   ```sh
   sudo cp deploy/nginx/<DOMAINNAME>.conf /etc/nginx/sites-available/<DOMAINNAME>
   sudo ln -sf /etc/nginx/sites-available/<DOMAINNAME> /etc/nginx/sites-enabled/<DOMAINNAME>
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d <DOMAINNAME>
   ```

   Point the DNS `A` (and `AAAA`, if you have one) record for your domain name
   at the VPS first, or certbot will fail to validate.

4. Check HTTPS end to end:

   ```sh
   curl -sI https://<DOMAINNAME>/api/health
   ```

5. Open the first invite link from step 2 (rewrite its host to
   `https://<DOMAINNAME>/invite/…` if you copied it from the log) and create
   the first account. That account can then invite the other three from the
   **Invite** button. The first-run invite is deleted as soon as the first
   account exists.

## Data and backups

`./data` next to `docker-compose.yml` holds everything:

- `lingutodo7.sqlite` — the whole database, WAL mode
- `backups/lingutodo7-YYYY-MM-DD.sqlite` — written nightly at 03:15 (server
  local time), seven kept

To restore, stop the container, replace `lingutodo7.sqlite` with a backup file
(and delete any `-wal`/`-shm` files beside it), and start it again. To take one
by hand:

```sh
docker compose exec app node -e "
const { openDb, backupDb } = await import('/app/server/src/db.ts');
backupDb(openDb('/data/lingutodo7.sqlite'), '/data/backups', 7);
"
```

The backup files sit on the host, so also let whatever already covers the VPS
(chosen rsync, snapshot, Hetzner backup) pick up `./data`.

## Updating

```sh
cd /srv/lingutodo7
git pull
docker compose up -d --build
```

Migrations run on start, inside a transaction, in filename order. There is no
downtime dance: the container is replaced in a second or two.

## Notes

- The container publishes on `127.0.0.1:8090` only, so nothing reaches it except
  the host nginx. Do not change that to `0.0.0.0`.
- `SECURE_COOKIES=true` plus nginx's `X-Forwarded-Proto` is what makes the
  session cookie `Secure`. If sign-in appears to "work but not stick", check that
  header first.
- The app trusts `X-Real-IP` / `X-Forwarded-For` for its login throttle. That is
  fine behind your own nginx, and would not be if it were exposed directly.
- `docker compose logs -f app` is usually enough to diagnose anything.
