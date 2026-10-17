# LinguTodo7

The household's shared lists: endless shopping lists, one-off packing lists, and
anything else four adults want to remember together. Phone-first, installable to
the home screen, and usable in a shop with no signal.

Live at <https://todo7.lingu.at>.

## What it does

- **Lists**, any number, each with a name and an emoji. Anyone can create one.
- **Items** are one line of text. A leading number is the amount: the **+** and
  **−** buttons count it up and down, and an item with no number counts as one,
  so `butter` → `2 butter` → `3 butter`. See
  [ADR 0001](docs/adr/0001-amount-as-leading-number-in-item-text.md).
- **Checking** an item strikes it through in place for five seconds — long enough
  to undo in the aisle — then it sinks greyed to the bottom of the list, where it
  stays until someone taps **Clear checked**.
- **Offline** the app keeps working from the device's own copy: every write is
  queued and pushed when the phone is back online. See
  [ADR 0002](docs/adr/0002-offline-first-with-full-write-outbox.md).
- **Permissions**: items are the family's — anyone can add, check, edit, delete
  and clear them, and pin any list. A list itself belongs to its **creator**,
  the only member who can rename, archive or delete it. Archived lists are
  read-only.
- **Accounts** are email + password, created only through a **single-use invite
  link**. There is no email service: a member shares the link directly, and the
  same link mechanism is how a forgotten password is reset.

The vocabulary lives in [GLOSSARY.md](GLOSSARY.md); the decisions that would look
odd without context live in [docs/adr/](docs/adr/).

## Running it locally

```sh
npm install
npm run build          # build the client into client/dist
npm start              # serve API + client on http://localhost:8080

# for development, two terminals:
npm run dev:server     # node --watch, port 8080
npm run dev:client     # vite on 5173, proxying /api to 8080
```

On a brand-new database the server prints a **first invite** link to its log.
Open it to create the first account; every later account is invited from the
**Invite** button inside the app.

`SECURE_COOKIES=false` is needed when running over plain http locally (the
default is `true`, matching production behind nginx).

## Tests

```sh
npm test               # API tests against a temporary SQLite file (node:test)
npm run test:e2e       # browser tests (Playwright, runs the production build)
npm run typecheck
```

The API tests cover permissions, last-write-wins, archived and deleted lists,
amount arithmetic, invites and the backup routine. The browser tests cover the
two things only a browser can: the checked item sinking after five seconds with
its undo window, and writes made with the network cut arriving afterwards —
including the case that cannot be saved because the list was deleted meanwhile.

## Deploying

See [deploy/README.md](deploy/README.md). In short: `docker compose up -d
--build` on the VPS, with host nginx terminating TLS for `todo7.lingu.at` and the
container published only on `127.0.0.1:8090`.

## How it is built

TypeScript throughout. The server is [Hono](https://hono.dev) on plain Node 24 —
SQLite comes from `node:sqlite` and queries are hand-written SQL against numbered
migrations ([ADR 0003](docs/adr/0003-plain-sql-instead-of-an-orm.md)), so the
runtime image has no dependencies beyond Hono. The client is React plus
IndexedDB, served as a static PWA from the same origin as the API, which keeps
cookies same-origin and deploys as one container.

Layout:

```
shared/schema.ts     types, operations, amount rule — used by both sides
server/src/          app, sync engine, auth, migrations, backups
server/test/         API tests
client/src/          React PWA, local database, outbox
client/test/         Playwright specs
deploy/nginx/        server block for todo7.lingu.at
```
