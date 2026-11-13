// Suggestions personnalisées à partir des notes de l'utilisateur.
//
// Score final = combinaison de :
//  - affinité de genres (profil construit à partir des notes, positives ou négatives)
//  - titres liés (recommandations TMDB des titres aimés)
//  - filtrage collaboratif (les membres qui ont aimé les mêmes titres ont aussi aimé…)
//  - qualité (notes des plateformes / communauté) et popularité
import { parseJsonArray } from '../util.js';
import { cardsByIds } from './queries.js';

const LIKE = 7;

export function recommend(db, userId, { limit = 20, type = null } = {}) {
  const signals = userId
    ? db.all(
        `SELECT title_id, score, 1 AS direct FROM title_ratings WHERE user_id = ?
         UNION ALL
         SELECT title_id, AVG(score) AS score, 0 AS direct FROM episode_ratings WHERE user_id = ? GROUP BY title_id`,
        userId,
        userId,
      )
    : [];

  const userScores = new Map();
  for (const s of signals) {
    if (!userScores.has(s.title_id) || s.direct) userScores.set(s.title_id, s.score);
  }

  if (userScores.size === 0) {
    return { personalized: false, items: popularFallback(db, userId, { limit, type }) };
  }

  const ratedIds = [...userScores.keys()];
  const rated = db.all(
    'SELECT id, type, title, genres FROM titles WHERE id IN (SELECT value FROM json_each(?))',
    JSON.stringify(ratedIds),
  );
  const ratedById = new Map(rated.map((r) => [r.id, r]));

  // Profil de genres et préférence film/série.
  const profile = new Map();
  const typeWeight = { movie: 0, series: 0 };
  for (const r of rated) {
    const w = userScores.get(r.id) - 5.5;
    for (const g of parseJsonArray(r.genres)) profile.set(g, (profile.get(g) || 0) + w);
    if (w > 0) typeWeight[r.type] += w;
  }
  const profileNorm = Math.sqrt([...profile.values()].reduce((s, v) => s + v * v, 0)) || 1;
  const typeTotal = typeWeight.movie + typeWeight.series || 1;

  const likedIds = ratedIds.filter((id) => userScores.get(id) >= LIKE);
  const likedJson = JSON.stringify(likedIds);

  // Titres liés aux titres aimés (dans les deux sens).
  const linkScore = new Map();
  if (likedIds.length) {
    const links = db.all(
      `SELECT title_id, related_id, rank FROM title_links
       WHERE title_id IN (SELECT value FROM json_each(?)) OR related_id IN (SELECT value FROM json_each(?))`,
      likedJson,
      likedJson,
    );
    for (const l of links) {
      const forward = userScores.has(l.title_id) && userScores.get(l.title_id) >= LIKE;
      const via = forward ? l.title_id : l.related_id;
      const cand = forward ? l.related_id : l.title_id;
      if (userScores.has(cand)) continue;
      const w = (userScores.get(via) - 5.5) * Math.max(0.2, 1 - l.rank / 20) * (forward ? 1 : 0.6);
      const cur = linkScore.get(cand);
      if (!cur) linkScore.set(cand, { score: w, via, best: w });
      else {
        cur.score += w;
        if (w > cur.best) Object.assign(cur, { via, best: w });
      }
    }
  }

  // Filtrage collaboratif simple (co-appréciation).
  const collab = new Map();
  if (likedIds.length) {
    const rows = db.all(
      `SELECT r2.title_id AS cid, r1.title_id AS via, COUNT(*) AS n
       FROM title_ratings r1
       JOIN title_ratings r2 ON r2.user_id = r1.user_id AND r2.title_id != r1.title_id
       WHERE r1.title_id IN (SELECT value FROM json_each(?)) AND r1.user_id != ?
         AND r1.score >= ? AND r2.score >= ?
       GROUP BY r2.title_id, r1.title_id`,
      likedJson,
      userId,
      LIKE,
      LIKE,
    );
    for (const r of rows) {
      if (userScores.has(r.cid)) continue;
      const cur = collab.get(r.cid);
      if (!cur) collab.set(r.cid, { score: r.n, via: r.via, best: r.n });
      else {
        cur.score += r.n;
        if (r.n > cur.best) Object.assign(cur, { via: r.via, best: r.n });
      }
    }
  }

  const candidates = db.all(
    `SELECT t.id, t.type, t.title, t.genres, t.popularity,
       (SELECT AVG(score) FROM title_external_ratings x WHERE x.title_id = t.id) AS ext_avg,
       (SELECT AVG(score) FROM title_ratings r WHERE r.title_id = t.id) AS community_avg
     FROM titles t
     WHERE t.id NOT IN (SELECT value FROM json_each(?)) ${type ? 'AND t.type = ?' : ''}
     ORDER BY t.popularity DESC LIMIT 2000`,
    JSON.stringify(ratedIds),
    ...(type ? [type] : []),
  );
  // Ajoute les titres liés/collaboratifs hors du top popularité.
  const known = new Set(candidates.map((c) => c.id));
  const extra = [...linkScore.keys(), ...collab.keys()].filter((id) => !known.has(id));
  if (extra.length) {
    candidates.push(
      ...db.all(
        `SELECT t.id, t.type, t.title, t.genres, t.popularity,
           (SELECT AVG(score) FROM title_external_ratings x WHERE x.title_id = t.id) AS ext_avg,
           (SELECT AVG(score) FROM title_ratings r WHERE r.title_id = t.id) AS community_avg
         FROM titles t WHERE t.id IN (SELECT value FROM json_each(?)) ${type ? 'AND t.type = ?' : ''}`,
        JSON.stringify(extra),
        ...(type ? [type] : []),
      ),
    );
  }

  const maxLink = Math.max(0, ...[...linkScore.values()].map((v) => v.score)) || 1;
  const maxCollab = Math.max(0, ...[...collab.values()].map((v) => v.score)) || 1;
  const maxPop = Math.max(1, ...candidates.map((c) => c.popularity || 0));

  const scored = [];
  for (const c of candidates) {
    const genres = parseJsonArray(c.genres);
    const content = genres.length
      ? genres.reduce((s, g) => s + (profile.get(g) || 0), 0) / (Math.sqrt(genres.length) * profileNorm)
      : 0;
    const link = linkScore.get(c.id);
    const co = collab.get(c.id);
    const linkN = link ? Math.max(0, link.score) / maxLink : 0;
    const collabN = co ? co.score / maxCollab : 0;
    const quality = (c.ext_avg ?? c.community_avg ?? 6) / 10;
    const pop = Math.log1p(c.popularity || 0) / Math.log1p(maxPop);
    const typePref = typeWeight[c.type] / typeTotal;

    // Genres que l'utilisateur n'aime pas et aucun autre signal : on écarte.
    if (content < -0.2 && !linkN && !collabN) continue;

    const score = 0.4 * content + 0.25 * linkN + 0.2 * collabN + 0.1 * quality + 0.05 * pop + 0.05 * typePref;
    scored.push({ id: c.id, score, reason: reasonFor({ linkN, collabN, link, co, genres, profile, ratedById }) });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const cards = cardsByIds(db, top.map((s) => s.id), userId);
  const reasons = new Map(top.map((s) => [s.id, s.reason]));
  return {
    personalized: true,
    basedOn: likedIds.length,
    items: cards.map((c) => ({ ...c, reason: reasons.get(c.id) })),
  };
}

function reasonFor({ linkN, collabN, link, co, genres, profile, ratedById }) {
  if (link && linkN >= 0.25 && ratedById.get(link.via)) {
    return { kind: 'similar', text: `Parce que vous avez aimé « ${ratedById.get(link.via).title} »`, viaId: link.via };
  }
  if (co && collabN >= 0.25 && ratedById.get(co.via)) {
    return { kind: 'collab', text: `Les fans de « ${ratedById.get(co.via).title} » ont adoré`, viaId: co.via };
  }
  const liked = genres
    .map((g) => [g, profile.get(g) || 0])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);
  if (liked.length) return { kind: 'genre', text: `Vous aimez : ${liked.join(', ')}` };
  return { kind: 'popular', text: 'Populaire en ce moment' };
}

function popularFallback(db, userId, { limit, type }) {
  const rows = db.all(
    `SELECT t.id FROM titles t ${type ? 'WHERE t.type = ?' : ''}
     ORDER BY t.popularity * 0.6 + COALESCE((SELECT AVG(score) FROM title_external_ratings x WHERE x.title_id = t.id), 6) * 4 DESC
     LIMIT ?`,
    ...(type ? [type] : []),
    limit,
  );
  return cardsByIds(db, rows.map((r) => r.id), userId).map((c) => ({
    ...c,
    reason: { kind: 'popular', text: 'Populaire en ce moment' },
  }));
}
