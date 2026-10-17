# Offline-first, with every write queued in a client outbox

The app is used on phones in shops and basements with no connection, so reading
and checking items offline is not optional. We decided to go further: the client
keeps a local copy of every list and queues **all** writes — add, edit, delete,
check, clear, create/rename/archive/delete list, pin — in an outbox that it
replays on reconnect, resolving conflicts per item with last-write-wins. A
partial offline mode (say, reads and check-offs only) was rejected because users
cannot remember which actions are offline-capable, and "my change vanished"
erodes trust in the whole app.

## Consequences

- Every syncable row needs an `updated_at` timestamp, and deletions need
  tombstones, so a stale client can be told an item is gone rather than
  resurrecting it.
- Last-write-wins discards the losing edit silently; only *lost writes against a
  deleted list* are surfaced to the user, as a visible notice.
- The outbox is the risky part of the codebase and is worth dedicated tests
  (Playwright, with the network cut) rather than only API tests.
