# Plain SQL with a small migration runner, no ORM

The database is a single SQLite file holding a handful of tables that will barely
change. We decided to write plain SQL against a tiny migration runner rather than
adopt an ORM or query builder such as Drizzle. An ORM's payoff scales with schema
churn, which this project does not have, and the queries that carry the real risk
here — idempotent upserts, tombstone-aware reads, last-write-wins conditionals —
read better as explicit SQL than as builder calls. Types that matter are the API
contract, shared with the front end from a schema definition, not the DB layer.

## Consequences

- Row-to-object mapping is written by hand.
- Schema changes go through numbered migration files, applied on server start.
- A reviewer tempted to "improve" this by adding an ORM should note the decision
  was deliberate.
