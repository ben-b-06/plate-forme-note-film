// Lecture du catalogue pour l'API (fiches, listes, agrégats de notes).
import { parseJsonArray, round1, now, DAY } from '../util.js';

// Le 1er paramètre positionnel est toujours l'id utilisateur (0 si anonyme).
export const CARD_COLS = `
  t.id, t.type, t.title, t.year, t.end_year, t.poster_url, t.genres, t.popularity,
  (SELECT AVG(x.score) FROM title_external_ratings x WHERE x.title_id = t.id) AS ext_avg,
  (SELECT AVG(r.score) FROM title_ratings r WHERE r.title_id = t.id) AS community_avg,
  (SELECT COUNT(*) FROM title_ratings r WHERE r.title_id = t.id) AS community_count,
  (SELECT m.score FROM title_ratings m WHERE m.title_id = t.id AND m.user_id = ?) AS my_score`;

export function toCard(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    year: row.year,
    endYear: row.end_year,
    poster: row.poster_url,
    genres: parseJsonArray(row.genres),
    extScore: round1(row.ext_avg),
    communityScore: round1(row.community_avg),
    communityCount: row.community_count || 0,
    myScore: row.my_score ?? null,
  };
}

export function cardsByIds(db, ids, userId = 0) {
  if (!ids.length) return [];
  const rows = db.all(
    `SELECT ${CARD_COLS} FROM titles t WHERE t.id IN (SELECT value FROM json_each(?))`,
    userId || 0,
    JSON.stringify(ids),
  );
  const byId = new Map(rows.map((r) => [r.id, toCard(r)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

const SORTS = {
  popular: 't.popularity DESC, t.id DESC',
  rating: 'COALESCE(ext_avg, community_avg) DESC NULLS LAST, t.popularity DESC',
  community: 'community_avg DESC NULLS LAST, community_count DESC',
  recent: 't.year DESC NULLS LAST, t.release_date DESC NULLS LAST, t.popularity DESC',
  title: 't.title COLLATE NOCASE ASC',
};

export function listTitles(db, { type, genre, sort = 'popular', page = 1, pageSize = 24, userId = 0, q } = {}) {
  const where = [];
  const params = [];
  if (type === 'movie' || type === 'series') {
    where.push('t.type = ?');
    params.push(type);
  }
  if (genre) {
    where.push('EXISTS (SELECT 1 FROM json_each(t.genres) g WHERE g.value = ?)');
    params.push(genre);
  }
  if (q) {
    for (const word of q.split(' ').filter(Boolean).slice(0, 6)) {
      where.push('t.search_text LIKE ?');
      params.push(`%${word}%`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[sort] || SORTS.popular;
  const size = Math.min(60, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * size;
  const total = db.get(`SELECT COUNT(*) AS n FROM titles t ${whereSql}`, ...params).n;
  const rows = db.all(
    `SELECT ${CARD_COLS} FROM titles t ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    userId || 0,
    ...params,
    size,
    offset,
  );
  return { total, page: Math.max(1, page), pageSize: size, items: rows.map(toCard) };
}

export function listGenres(db, type) {
  const rows = db.all(
    `SELECT g.value AS name, COUNT(*) AS n FROM titles t, json_each(t.genres) g
     ${type ? 'WHERE t.type = ?' : ''} GROUP BY g.value ORDER BY n DESC, g.value`,
    ...(type ? [type] : []),
  );
  return rows.map((r) => ({ name: r.name, count: r.n }));
}

const SOURCE_ORDER = ['imdb', 'rotten_tomatoes', 'metacritic', 'tmdb', 'tvmaze'];

function externalRatings(rows) {
  return rows
    .map((r) => ({
      source: r.source,
      score: round1(r.score),
      display: r.display,
      votes: r.votes,
      url: r.url,
      updatedAt: r.updated_at,
    }))
    .sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
}

export function getTitle(db, id, userId = 0) {
  const t = db.get('SELECT * FROM titles WHERE id = ?', id);
  if (!t) return null;
  const ext = externalRatings(db.all('SELECT * FROM title_external_ratings WHERE title_id = ?', id));
  const community = db.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM title_ratings WHERE title_id = ?', id);
  const dist = db.all('SELECT score, COUNT(*) AS n FROM title_ratings WHERE title_id = ? GROUP BY score', id);
  const distribution = Array.from({ length: 10 }, (_, i) => dist.find((d) => d.score === i + 1)?.n || 0);
  const mine = userId
    ? db.get('SELECT score FROM title_ratings WHERE title_id = ? AND user_id = ?', id, userId)
    : null;

  const result = {
    id: t.id,
    type: t.type,
    title: t.title,
    originalTitle: t.original_title && t.original_title !== t.title ? t.original_title : null,
    overview: t.overview,
    year: t.year,
    endYear: t.end_year,
    releaseDate: t.release_date,
    runtime: t.runtime,
    status: t.status,
    poster: t.poster_large_url || t.poster_url,
    backdrop: t.backdrop_url,
    genres: parseJsonArray(t.genres),
    network: t.network,
    imdbId: t.imdb_id,
    links: externalLinks(t),
    externalRatings: ext,
    externalScore: ext.length ? round1(ext.reduce((s, r) => s + r.score, 0) / ext.length) : null,
    community: {
      score: round1(community.avg),
      count: community.n,
      distribution,
    },
    myScore: mine?.score ?? null,
    commentCount: db.get('SELECT COUNT(*) AS n FROM comments WHERE title_id = ? AND episode_id IS NULL', id).n,
    updatedAt: t.updated_at,
  };

  if (t.type === 'series') {
    const ep = db.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM episode_ratings WHERE title_id = ?', id);
    result.episodesCommunity = { score: round1(ep.avg), count: ep.n };
    if (userId) {
      const me = db.get(
        'SELECT AVG(score) AS avg, COUNT(*) AS n FROM episode_ratings WHERE title_id = ? AND user_id = ?',
        id,
        userId,
      );
      result.myEpisodes = { score: round1(me.avg), count: me.n };
    }
    result.seasons = db.all(
      `SELECT s.season_number AS number, s.name, s.air_date AS airDate, s.poster_url AS poster,
         (SELECT COUNT(*) FROM episodes e WHERE e.title_id = s.title_id AND e.season_number = s.season_number) AS episodeCount,
         (SELECT AVG(er.score) FROM episode_ratings er JOIN episodes e ON e.id = er.episode_id
            WHERE e.title_id = s.title_id AND e.season_number = s.season_number) AS communityScore,
         (SELECT COUNT(*) FROM episode_ratings er JOIN episodes e ON e.id = er.episode_id
            WHERE e.title_id = s.title_id AND e.season_number = s.season_number AND er.user_id = ?) AS myRatedCount
       FROM seasons s WHERE s.title_id = ? AND s.season_number > 0 ORDER BY s.season_number`,
      userId || 0,
      id,
    ).map((s) => ({ ...s, communityScore: round1(s.communityScore) }));
  }

  result.similar = similarTitles(db, t, userId);
  return result;
}

function externalLinks(t) {
  const links = [];
  if (t.imdb_id) links.push({ source: 'imdb', url: `https://www.imdb.com/title/${t.imdb_id}/` });
  if (t.tmdb_id)
    links.push({ source: 'tmdb', url: `https://www.themoviedb.org/${t.type === 'movie' ? 'movie' : 'tv'}/${t.tmdb_id}` });
  if (t.tvmaze_id) links.push({ source: 'tvmaze', url: `https://www.tvmaze.com/shows/${t.tvmaze_id}` });
  return links;
}

export function similarTitles(db, t, userId = 0, limit = 12) {
  const linked = db
    .all(
      `SELECT related_id AS id, MIN(rank) AS rk FROM title_links WHERE title_id = ?
       GROUP BY related_id ORDER BY rk LIMIT ?`,
      t.id,
      limit,
    )
    .map((r) => r.id);
  let ids = linked;
  if (ids.length < limit) {
    const genres = new Set(parseJsonArray(t.genres));
    if (genres.size) {
      const pool = db.all(
        `SELECT id, genres, popularity FROM titles WHERE type = ? AND id != ? ORDER BY popularity DESC LIMIT 400`,
        t.type,
        t.id,
      );
      const scored = pool
        .filter((p) => !ids.includes(p.id))
        .map((p) => {
          const g = parseJsonArray(p.genres);
          const inter = g.filter((x) => genres.has(x)).length;
          const union = new Set([...g, ...genres]).size || 1;
          return { id: p.id, s: inter / union + Math.min(p.popularity, 100) / 1000 };
        })
        .filter((p) => p.s > 0.2)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit - ids.length)
        .map((p) => p.id);
      ids = [...ids, ...scored];
    }
  }
  return cardsByIds(db, ids, userId);
}

function episodeRow(e, ext) {
  return {
    id: e.id,
    season: e.season_number,
    number: e.episode_number,
    name: e.name,
    overview: e.overview,
    airDate: e.air_date,
    runtime: e.runtime,
    still: e.still_url,
    communityScore: round1(e.community_avg),
    communityCount: e.community_count || 0,
    myScore: e.my_score ?? null,
    externalRatings: ext,
  };
}

export function getSeason(db, titleId, seasonNumber, userId = 0) {
  const rows = db.all(
    `SELECT e.*,
       (SELECT AVG(score) FROM episode_ratings r WHERE r.episode_id = e.id) AS community_avg,
       (SELECT COUNT(*) FROM episode_ratings r WHERE r.episode_id = e.id) AS community_count,
       (SELECT score FROM episode_ratings m WHERE m.episode_id = e.id AND m.user_id = ?) AS my_score
     FROM episodes e WHERE e.title_id = ? AND e.season_number = ? ORDER BY e.episode_number`,
    userId || 0,
    titleId,
    seasonNumber,
  );
  const ext = db.all(
    `SELECT x.* FROM episode_external_ratings x JOIN episodes e ON e.id = x.episode_id
     WHERE e.title_id = ? AND e.season_number = ?`,
    titleId,
    seasonNumber,
  );
  const extByEp = new Map();
  for (const r of ext) {
    if (!extByEp.has(r.episode_id)) extByEp.set(r.episode_id, []);
    extByEp.get(r.episode_id).push(r);
  }
  const season = db.get(
    'SELECT season_number AS number, name, overview, air_date AS airDate, poster_url AS poster FROM seasons WHERE title_id = ? AND season_number = ?',
    titleId,
    seasonNumber,
  );
  return {
    ...(season || { number: seasonNumber, name: `Saison ${seasonNumber}` }),
    episodes: rows.map((e) => episodeRow(e, externalRatings(extByEp.get(e.id) || []))),
  };
}

export function getEpisode(db, id, userId = 0) {
  const e = db.get(
    `SELECT e.*,
       (SELECT AVG(score) FROM episode_ratings r WHERE r.episode_id = e.id) AS community_avg,
       (SELECT COUNT(*) FROM episode_ratings r WHERE r.episode_id = e.id) AS community_count,
       (SELECT score FROM episode_ratings m WHERE m.episode_id = e.id AND m.user_id = ?) AS my_score
     FROM episodes e WHERE e.id = ?`,
    userId || 0,
    id,
  );
  if (!e) return null;
  const ext = externalRatings(db.all('SELECT * FROM episode_external_ratings WHERE episode_id = ?', id));
  const title = db.get('SELECT id, title, poster_url, backdrop_url, type FROM titles WHERE id = ?', e.title_id);
  const neighbours = (dir) =>
    db.get(
      `SELECT id, season_number, episode_number, name FROM episodes WHERE title_id = ? AND
         (season_number, episode_number) ${dir === 'prev' ? '<' : '>'} (?, ?)
       ORDER BY season_number ${dir === 'prev' ? 'DESC' : 'ASC'}, episode_number ${dir === 'prev' ? 'DESC' : 'ASC'} LIMIT 1`,
      e.title_id,
      e.season_number,
      e.episode_number,
    );
  const dist = db.all('SELECT score, COUNT(*) AS n FROM episode_ratings WHERE episode_id = ? GROUP BY score', id);
  const nav = (n) => n && { id: n.id, season: n.season_number, number: n.episode_number, name: n.name };
  return {
    ...episodeRow(e, ext),
    distribution: Array.from({ length: 10 }, (_, i) => dist.find((d) => d.score === i + 1)?.n || 0),
    series: { id: title.id, title: title.title, poster: title.poster_url, backdrop: title.backdrop_url },
    prev: nav(neighbours('prev')),
    next: nav(neighbours('next')),
  };
}

/** Séries en cours pour l'utilisateur : prochain épisode non noté après le dernier noté. */
export function continueWatching(db, userId, limit = 10) {
  if (!userId) return [];
  const rows = db.all(
    `SELECT er.title_id, MAX(er.updated_at) AS last FROM episode_ratings er
     WHERE er.user_id = ? GROUP BY er.title_id ORDER BY last DESC LIMIT ?`,
    userId,
    limit * 2,
  );
  const out = [];
  for (const r of rows) {
    const lastEp = db.get(
      `SELECT e.season_number, e.episode_number FROM episode_ratings er JOIN episodes e ON e.id = er.episode_id
       WHERE er.user_id = ? AND er.title_id = ? ORDER BY e.season_number DESC, e.episode_number DESC LIMIT 1`,
      userId,
      r.title_id,
    );
    const next = db.get(
      `SELECT e.id, e.season_number, e.episode_number, e.name, e.air_date FROM episodes e
       WHERE e.title_id = ? AND (e.season_number, e.episode_number) > (?, ?) AND e.season_number > 0
         AND NOT EXISTS (SELECT 1 FROM episode_ratings m WHERE m.episode_id = e.id AND m.user_id = ?)
       ORDER BY e.season_number, e.episode_number LIMIT 1`,
      r.title_id,
      lastEp.season_number,
      lastEp.episode_number,
      userId,
    );
    if (!next) continue;
    const t = db.get('SELECT id, title, poster_url FROM titles WHERE id = ?', r.title_id);
    out.push({
      series: { id: t.id, title: t.title, poster: t.poster_url },
      episode: { id: next.id, season: next.season_number, number: next.episode_number, name: next.name, airDate: next.air_date },
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function recentEpisodes(db, limit = 16) {
  const today = new Date();
  const from = new Date(today.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  return db
    .all(
      `SELECT e.id, e.season_number, e.episode_number, e.name, e.air_date, t.id AS tid, t.title, t.poster_url
       FROM episodes e JOIN titles t ON t.id = e.title_id
       WHERE e.air_date BETWEEN ? AND ? ORDER BY e.air_date DESC, t.popularity DESC LIMIT ?`,
      from,
      to,
      limit,
    )
    .map((r) => ({
      series: { id: r.tid, title: r.title, poster: r.poster_url },
      episode: { id: r.id, season: r.season_number, number: r.episode_number, name: r.name, airDate: r.air_date },
    }));
}

export function trending(db, type, userId = 0, limit = 20) {
  const recent = now() - 14 * DAY;
  const rows = db.all(
    `SELECT ${CARD_COLS} FROM titles t WHERE t.type = ?
     ORDER BY (t.trending_at IS NOT NULL AND t.trending_at > ?) DESC, t.trending_rank ASC NULLS LAST, t.popularity DESC
     LIMIT ?`,
    userId || 0,
    type,
    recent,
    limit,
  );
  return rows.map(toCard);
}

/** Meilleures notes de la communauté (moyenne bayésienne pour limiter l'effet « 1 seule note »). */
export function topCommunity(db, userId = 0, limit = 20) {
  const global = db.get('SELECT AVG(score) AS m FROM title_ratings').m || 6;
  const C = 3;
  const rows = db.all(
    `SELECT r.title_id AS id, (? * ? + SUM(r.score)) / (? + COUNT(*)) AS bayes
     FROM title_ratings r GROUP BY r.title_id ORDER BY bayes DESC LIMIT ?`,
    C,
    global,
    C,
    limit,
  );
  return cardsByIds(db, rows.map((r) => r.id), userId);
}

export function topExternal(db, userId = 0, limit = 20) {
  const rows = db.all(
    `SELECT x.title_id AS id, AVG(x.score) AS s, COUNT(*) AS n FROM title_external_ratings x
     GROUP BY x.title_id HAVING n >= 1 ORDER BY s DESC LIMIT ?`,
    limit,
  );
  return cardsByIds(db, rows.map((r) => r.id), userId);
}

export function userRatings(db, userId) {
  const titles = db.all(
    `SELECT ${CARD_COLS}, tr.updated_at AS rated_at FROM title_ratings tr JOIN titles t ON t.id = tr.title_id
     WHERE tr.user_id = ? ORDER BY tr.updated_at DESC`,
    userId,
    userId,
  );
  const series = db.all(
    `SELECT t.id, t.title, t.poster_url, COUNT(*) AS n, AVG(er.score) AS avg, MAX(er.updated_at) AS last
     FROM episode_ratings er JOIN titles t ON t.id = er.title_id WHERE er.user_id = ?
     GROUP BY t.id ORDER BY last DESC`,
    userId,
  );
  const stats = db.get(
    `SELECT (SELECT COUNT(*) FROM title_ratings WHERE user_id = ?) AS titles,
            (SELECT COUNT(*) FROM episode_ratings WHERE user_id = ?) AS episodes,
            (SELECT AVG(score) FROM title_ratings WHERE user_id = ?) AS avg,
            (SELECT COUNT(*) FROM comments WHERE user_id = ?) AS comments`,
    userId,
    userId,
    userId,
    userId,
  );
  return {
    stats: { ...stats, avg: round1(stats.avg) },
    titles: titles.map((r) => ({ ...toCard(r), ratedAt: r.rated_at })),
    episodesBySeries: series.map((s) => ({
      id: s.id,
      title: s.title,
      poster: s.poster_url,
      count: s.n,
      score: round1(s.avg),
    })),
  };
}
