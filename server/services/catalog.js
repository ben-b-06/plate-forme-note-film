// Écriture du catalogue (titres, saisons, épisodes, notes externes) avec
// dédoublonnage entre les sources (IMDb / TMDB / TVmaze).
import { normalizeText, now, parseJsonArray } from '../util.js';

const TITLE_FIELDS = [
  'title',
  'original_title',
  'overview',
  'year',
  'end_year',
  'release_date',
  'runtime',
  'status',
  'poster_url',
  'poster_large_url',
  'backdrop_url',
  'network',
  'popularity',
];

const ID_FIELDS = ['imdb_id', 'tmdb_id', 'tvmaze_id'];

export function findTitle(db, { type, imdb_id, tmdb_id, tvmaze_id }) {
  if (tmdb_id != null && type) {
    const row = db.get('SELECT * FROM titles WHERE type = ? AND tmdb_id = ?', type, tmdb_id);
    if (row) return row;
  }
  if (imdb_id) {
    const row = db.get('SELECT * FROM titles WHERE imdb_id = ?', imdb_id);
    if (row) return row;
  }
  if (tvmaze_id != null) {
    const row = db.get('SELECT * FROM titles WHERE tvmaze_id = ?', tvmaze_id);
    if (row) return row;
  }
  return null;
}

function idTaken(db, field, value, type, selfId) {
  if (value == null) return false;
  const row =
    field === 'tmdb_id'
      ? db.get('SELECT id FROM titles WHERE type = ? AND tmdb_id = ?', type, value)
      : db.get(`SELECT id FROM titles WHERE ${field} = ?`, value);
  return Boolean(row && row.id !== selfId);
}

/**
 * Insère ou met à jour un titre.
 * - `authoritative` : les champs non nuls écrasent l'existant (ex. TMDB en français).
 *   Sinon on ne remplit que les champs vides (ex. TVmaze, en anglais).
 * Retourne l'id local.
 */
export function upsertTitle(db, data, { authoritative = false, source = null } = {}) {
  const t = now();
  const existing = findTitle(db, data);
  const genres = Array.isArray(data.genres) ? data.genres : null;

  if (!existing) {
    const row = {
      type: data.type,
      title: data.title,
      original_title: data.original_title ?? null,
      search_text: normalizeText(`${data.title} ${data.original_title || ''}`),
      overview: data.overview ?? null,
      year: data.year ?? null,
      end_year: data.end_year ?? null,
      release_date: data.release_date ?? null,
      runtime: data.runtime ?? null,
      status: data.status ?? null,
      poster_url: data.poster_url ?? null,
      poster_large_url: data.poster_large_url ?? null,
      backdrop_url: data.backdrop_url ?? null,
      genres: JSON.stringify(genres || []),
      network: data.network ?? null,
      imdb_id: data.imdb_id ?? null,
      tmdb_id: data.tmdb_id ?? null,
      tvmaze_id: data.tvmaze_id ?? null,
      popularity: data.popularity ?? 0,
      source: source ?? data.source ?? null,
      created_at: t,
      updated_at: t,
    };
    const cols = Object.keys(row);
    const r = db.run(
      `INSERT INTO titles (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...cols.map((c) => row[c]),
    );
    return r.lastInsertRowid;
  }

  const sets = [];
  const params = [];
  for (const f of TITLE_FIELDS) {
    const v = data[f];
    if (v == null || v === '') continue;
    if (authoritative || existing[f] == null || existing[f] === '' || (f === 'popularity' && !existing[f])) {
      if (existing[f] !== v) {
        sets.push(`${f} = ?`);
        params.push(v);
      }
    }
  }
  for (const f of ID_FIELDS) {
    const v = data[f];
    if (v != null && existing[f] == null && !idTaken(db, f, v, existing.type, existing.id)) {
      sets.push(`${f} = ?`);
      params.push(v);
    }
  }
  if (genres && genres.length) {
    const current = parseJsonArray(existing.genres);
    if (authoritative || current.length === 0) {
      sets.push('genres = ?');
      params.push(JSON.stringify(genres));
    }
  }
  const newTitle = sets.some((s) => s.startsWith('title =') || s.startsWith('original_title ='));
  if (newTitle) {
    const title = authoritative && data.title ? data.title : existing.title;
    const orig = data.original_title ?? existing.original_title ?? '';
    sets.push('search_text = ?');
    params.push(normalizeText(`${title} ${orig}`));
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(t);
    db.run(`UPDATE titles SET ${sets.join(', ')} WHERE id = ?`, ...params, existing.id);
  }
  return existing.id;
}

export function markTitle(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.run(
    `UPDATE titles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => fields[k]),
    id,
  );
}

export function upsertSeason(db, titleId, s, { authoritative = false } = {}) {
  const existing = db.get(
    'SELECT * FROM seasons WHERE title_id = ? AND season_number = ?',
    titleId,
    s.season_number,
  );
  if (!existing) {
    db.run(
      `INSERT INTO seasons (title_id, season_number, name, overview, poster_url, air_date, episode_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      titleId,
      s.season_number,
      s.name ?? null,
      s.overview ?? null,
      s.poster_url ?? null,
      s.air_date ?? null,
      s.episode_count ?? null,
    );
    return;
  }
  const sets = [];
  const params = [];
  for (const f of ['name', 'overview', 'poster_url', 'air_date', 'episode_count']) {
    const v = s[f];
    if (v == null || v === '') continue;
    if ((authoritative || existing[f] == null) && existing[f] !== v) {
      sets.push(`${f} = ?`);
      params.push(v);
    }
  }
  if (sets.length) db.run(`UPDATE seasons SET ${sets.join(', ')} WHERE id = ?`, ...params, existing.id);
}

/** Insère/maj un épisode, retourne son id local. */
export function upsertEpisode(db, titleId, e, { authoritative = false } = {}) {
  const t = now();
  const existing = db.get(
    'SELECT * FROM episodes WHERE title_id = ? AND season_number = ? AND episode_number = ?',
    titleId,
    e.season_number,
    e.episode_number,
  );
  if (!existing) {
    const r = db.run(
      `INSERT INTO episodes (title_id, season_number, episode_number, name, overview, air_date, runtime,
                             still_url, imdb_id, tvmaze_id, tmdb_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      titleId,
      e.season_number,
      e.episode_number,
      e.name ?? null,
      e.overview ?? null,
      e.air_date ?? null,
      e.runtime ?? null,
      e.still_url ?? null,
      e.imdb_id ?? null,
      e.tvmaze_id ?? null,
      e.tmdb_id ?? null,
      t,
    );
    return r.lastInsertRowid;
  }
  const sets = [];
  const params = [];
  for (const f of ['name', 'overview', 'air_date', 'runtime', 'still_url']) {
    const v = e[f];
    if (v == null || v === '') continue;
    // Les noms génériques (« Épisode 3 ») sont toujours remplacés par un vrai titre.
    const generic = f === 'name' && /^(épisode|episode)\s*\d+$/i.test(existing.name || '');
    if ((authoritative || existing[f] == null || generic) && existing[f] !== v) {
      sets.push(`${f} = ?`);
      params.push(v);
    }
  }
  for (const f of ['imdb_id', 'tvmaze_id', 'tmdb_id']) {
    if (e[f] != null && existing[f] == null) {
      sets.push(`${f} = ?`);
      params.push(e[f]);
    }
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(t);
    db.run(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`, ...params, existing.id);
  }
  return existing.id;
}

export function setTitleRating(db, titleId, source, r) {
  if (r == null || r.score == null || !Number.isFinite(r.score)) return;
  db.run(
    `INSERT INTO title_external_ratings (title_id, source, score, display, votes, url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(title_id, source) DO UPDATE SET score = excluded.score, display = excluded.display,
       votes = excluded.votes, url = COALESCE(excluded.url, url), updated_at = excluded.updated_at`,
    titleId,
    source,
    r.score,
    r.display,
    r.votes ?? null,
    r.url ?? null,
    now(),
  );
}

export function setEpisodeRating(db, episodeId, source, r) {
  if (r == null || r.score == null || !Number.isFinite(r.score)) return;
  db.run(
    `INSERT INTO episode_external_ratings (episode_id, source, score, display, votes, url, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(episode_id, source) DO UPDATE SET score = excluded.score, display = excluded.display,
       votes = excluded.votes, url = COALESCE(excluded.url, url), updated_at = excluded.updated_at`,
    episodeId,
    source,
    r.score,
    r.display,
    r.votes ?? null,
    r.url ?? null,
    now(),
  );
}

export function setLinks(db, titleId, relatedIds, source) {
  db.run('DELETE FROM title_links WHERE title_id = ? AND source = ?', titleId, source);
  relatedIds.forEach((rid, rank) => {
    if (rid === titleId) return;
    db.run(
      'INSERT OR IGNORE INTO title_links (title_id, related_id, source, rank) VALUES (?, ?, ?, ?)',
      titleId,
      rid,
      source,
      rank,
    );
  });
}

/**
 * Importe un titre complet décrit par un provider (titre + saisons + épisodes + notes).
 * `bundle` = { title, rating?, seasons?, episodes?: [{ ..., rating? }] }
 */
export function saveBundle(db, bundle, { authoritative = false, source } = {}) {
  return db.tx(() => {
    const titleId = upsertTitle(db, bundle.title, { authoritative, source });
    if (bundle.rating) setTitleRating(db, titleId, source, bundle.rating);
    for (const s of bundle.seasons || []) upsertSeason(db, titleId, s, { authoritative });
    for (const e of bundle.episodes || []) {
      const epId = upsertEpisode(db, titleId, e, { authoritative });
      if (e.rating) setEpisodeRating(db, epId, source, e.rating);
    }
    // S'assure que chaque saison ayant des épisodes existe.
    db.run(
      `INSERT OR IGNORE INTO seasons (title_id, season_number, name, episode_count)
       SELECT title_id, season_number, 'Saison ' || season_number, COUNT(*)
       FROM episodes WHERE title_id = ? GROUP BY season_number`,
      titleId,
    );
    return titleId;
  });
}

/**
 * Fusionne le titre `dropId` dans `keepId` (doublon détecté entre deux sources) :
 * notes, commentaires, épisodes, liens et identifiants sont transférés.
 */
export function mergeTitles(db, keepId, dropId) {
  if (keepId === dropId) return keepId;
  db.tx(() => {
    const keep = db.get('SELECT * FROM titles WHERE id = ?', keepId);
    const drop = db.get('SELECT * FROM titles WHERE id = ?', dropId);
    if (!keep || !drop) return;

    db.run('UPDATE OR IGNORE title_ratings SET title_id = ? WHERE title_id = ?', keepId, dropId);
    db.run('UPDATE OR IGNORE title_external_ratings SET title_id = ? WHERE title_id = ?', keepId, dropId);
    db.run('UPDATE comments SET title_id = ? WHERE title_id = ?', keepId, dropId);
    db.run('UPDATE OR IGNORE title_links SET title_id = ? WHERE title_id = ?', keepId, dropId);
    db.run('UPDATE OR IGNORE title_links SET related_id = ? WHERE related_id = ?', keepId, dropId);
    db.run('DELETE FROM title_links WHERE title_id = related_id');

    for (const e of db.all('SELECT * FROM episodes WHERE title_id = ?', dropId)) {
      const twin = db.get(
        'SELECT id FROM episodes WHERE title_id = ? AND season_number = ? AND episode_number = ?',
        keepId,
        e.season_number,
        e.episode_number,
      );
      if (twin) {
        db.run('UPDATE OR IGNORE episode_ratings SET episode_id = ?, title_id = ? WHERE episode_id = ?', twin.id, keepId, e.id);
        db.run('UPDATE OR IGNORE episode_external_ratings SET episode_id = ? WHERE episode_id = ?', twin.id, e.id);
        db.run('UPDATE comments SET episode_id = ? WHERE episode_id = ?', twin.id, e.id);
        db.run('DELETE FROM episodes WHERE id = ?', e.id);
      } else {
        db.run('UPDATE episodes SET title_id = ? WHERE id = ?', keepId, e.id);
        db.run('UPDATE episode_ratings SET title_id = ? WHERE episode_id = ?', keepId, e.id);
      }
    }
    db.run('UPDATE OR IGNORE seasons SET title_id = ? WHERE title_id = ?', keepId, dropId);

    // Identifiants manquants : on libère d'abord ceux du doublon (index uniques).
    const ids = {};
    for (const f of ['imdb_id', 'tmdb_id', 'tvmaze_id']) if (keep[f] == null && drop[f] != null) ids[f] = drop[f];
    const fill = {};
    for (const f of ['overview', 'poster_url', 'poster_large_url', 'backdrop_url', 'runtime', 'network', 'year', 'release_date']) {
      if (keep[f] == null && drop[f] != null) fill[f] = drop[f];
    }
    db.run('DELETE FROM titles WHERE id = ?', dropId);
    markTitle(db, keepId, { ...ids, ...fill, popularity: Math.max(keep.popularity || 0, drop.popularity || 0) });
  });
  return keepId;
}

/**
 * Avant d'enregistrer des identifiants sur le titre `id`, fusionne les éventuels
 * autres titres qui les portent déjà. Retourne l'id du titre conservé.
 */
export function resolveDuplicates(db, id, { type, imdb_id, tmdb_id, tvmaze_id }) {
  let current = id;
  const others = [];
  if (imdb_id) others.push(db.get('SELECT id FROM titles WHERE imdb_id = ? AND id != ?', imdb_id, current));
  if (tmdb_id != null) others.push(db.get('SELECT id FROM titles WHERE type = ? AND tmdb_id = ? AND id != ?', type, tmdb_id, current));
  if (tvmaze_id != null) others.push(db.get('SELECT id FROM titles WHERE tvmaze_id = ? AND id != ?', tvmaze_id, current));
  for (const o of others) {
    if (!o || o.id === current) continue;
    const keep = Math.min(current, o.id);
    const drop = Math.max(current, o.id);
    if (!db.get('SELECT 1 FROM titles WHERE id = ?', drop)) continue;
    mergeTitles(db, keep, drop);
    current = keep;
  }
  return current;
}
