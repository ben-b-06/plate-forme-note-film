// Accès à la base SQLite (module natif node:sqlite, aucune dépendance native à compiler).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  // v1 : schéma initial
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    premium_until INTEGER,
    premium_provider TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX users_stripe_sub ON users(stripe_subscription_id);
  CREATE INDEX users_stripe_customer ON users(stripe_customer_id);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE titles (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('movie', 'series')),
    title TEXT NOT NULL,
    original_title TEXT,
    search_text TEXT NOT NULL DEFAULT '',
    overview TEXT,
    year INTEGER,
    end_year INTEGER,
    release_date TEXT,
    runtime INTEGER,
    status TEXT,
    poster_url TEXT,
    poster_large_url TEXT,
    backdrop_url TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    network TEXT,
    imdb_id TEXT,
    tmdb_id INTEGER,
    tvmaze_id INTEGER,
    popularity REAL NOT NULL DEFAULT 0,
    trending_rank INTEGER,
    trending_at INTEGER,
    source TEXT,
    details_synced_at INTEGER,
    tvmaze_synced_at INTEGER,
    omdb_synced_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX titles_imdb ON titles(imdb_id) WHERE imdb_id IS NOT NULL;
  CREATE UNIQUE INDEX titles_tmdb ON titles(type, tmdb_id) WHERE tmdb_id IS NOT NULL;
  CREATE UNIQUE INDEX titles_tvmaze ON titles(tvmaze_id) WHERE tvmaze_id IS NOT NULL;
  CREATE INDEX titles_type_pop ON titles(type, popularity DESC);
  CREATE INDEX titles_trending ON titles(trending_at DESC, trending_rank);

  CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    name TEXT,
    overview TEXT,
    poster_url TEXT,
    air_date TEXT,
    episode_count INTEGER,
    UNIQUE (title_id, season_number)
  );

  CREATE TABLE episodes (
    id INTEGER PRIMARY KEY,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    name TEXT,
    overview TEXT,
    air_date TEXT,
    runtime INTEGER,
    still_url TEXT,
    imdb_id TEXT,
    tvmaze_id INTEGER,
    tmdb_id INTEGER,
    updated_at INTEGER,
    UNIQUE (title_id, season_number, episode_number)
  );
  CREATE INDEX episodes_air_date ON episodes(air_date);

  CREATE TABLE title_external_ratings (
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    score REAL NOT NULL,
    display TEXT NOT NULL,
    votes INTEGER,
    url TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (title_id, source)
  );

  CREATE TABLE episode_external_ratings (
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    score REAL NOT NULL,
    display TEXT NOT NULL,
    votes INTEGER,
    url TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (episode_id, source)
  );

  CREATE TABLE title_links (
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    related_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (title_id, related_id, source)
  );

  CREATE TABLE title_ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, title_id)
  );
  CREATE INDEX title_ratings_title ON title_ratings(title_id);

  CREATE TABLE episode_ratings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, episode_id)
  );
  CREATE INDEX episode_ratings_episode ON episode_ratings(episode_id);
  CREATE INDEX episode_ratings_title ON episode_ratings(title_id, user_id);

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    spoiler INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX comments_target ON comments(title_id, episode_id, created_at DESC);

  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY,
    reason TEXT,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    stats TEXT,
    error TEXT
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `,
];

/**
 * Ouvre (et migre) la base. `path` peut valoir ':memory:' pour les tests.
 */
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    raw.exec('PRAGMA journal_mode = WAL;');
    raw.exec('PRAGMA busy_timeout = 5000;');
  }
  migrate(raw);
  return wrap(raw);
}

function migrate(raw) {
  const { user_version: current } = raw.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.exec('BEGIN');
    try {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }
}

// node:sqlite refuse undefined et les booléens : on normalise les paramètres.
function norm(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p && typeof p === 'object' && !(p instanceof Uint8Array)) {
      const o = {};
      for (const [k, v] of Object.entries(p)) {
        o[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
      }
      return o;
    }
    return p;
  });
}

function plain(row) {
  return row ? { ...row } : row;
}

function wrap(raw) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  const db = {
    raw,
    all: (sql, ...params) => stmt(sql).all(...norm(params)).map(plain),
    get: (sql, ...params) => plain(stmt(sql).get(...norm(params))),
    run: (sql, ...params) => {
      const r = stmt(sql).run(...norm(params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec: (sql) => raw.exec(sql),
    /** Exécute fn dans une transaction (réentrante via SAVEPOINT). */
    tx(fn) {
      const name = `sp${depth}`;
      raw.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
      depth++;
      try {
        const result = fn();
        depth--;
        raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (err) {
        depth--;
        raw.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    },
    getMeta(key) {
      return db.get('SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
    },
    setMeta(key, value) {
      db.run(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value == null ? null : String(value),
      );
    },
    close: () => raw.close(),
  };
  return db;
}
