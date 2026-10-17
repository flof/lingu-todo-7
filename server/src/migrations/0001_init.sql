-- The whole schema for the household lists app. See GLOSSARY.md for the words.
-- Deleted rows stay as tombstones (deleted_at) so that an offline client cannot
-- resurrect them with a stale queued write (ADR 0002).

create table members (
  id            text primary key,
  email         text not null collate nocase unique,
  name          text not null,
  password_hash text not null,
  created_at    integer not null,
  updated_at    integer not null
);

create table sessions (
  token_hash   text primary key,
  member_id    text not null references members (id) on delete cascade,
  created_at   integer not null,
  last_seen_at integer not null
);

create table invites (
  token_hash text primary key,
  -- Null for the invitation the server prints on a brand-new database, before
  -- any member exists to have created it.
  created_by text references members (id) on delete cascade,
  created_at integer not null,
  expires_at integer not null,
  used_at    integer,
  used_by    text references members (id)
);

create table lists (
  id         text primary key,
  name       text not null,
  emoji      text not null default '',
  created_by text not null references members (id),
  archived   integer not null default 0,
  created_at integer not null,
  updated_at integer not null,
  deleted_at integer
);

create table items (
  id         text primary key,
  list_id    text not null references lists (id) on delete cascade,
  text       text not null,
  checked    integer not null default 0,
  checked_at integer,
  created_at integer not null,
  updated_at integer not null,
  deleted_at integer
);

create index items_by_list on items (list_id, created_at);

create table pins (
  member_id  text not null references members (id) on delete cascade,
  list_id    text not null references lists (id) on delete cascade,
  pinned_at  integer not null,
  updated_at integer not null,
  deleted_at integer,
  primary key (member_id, list_id)
);

create table login_attempts (
  ip          text primary key,
  failures    integer not null default 0,
  blocked_until integer
);
