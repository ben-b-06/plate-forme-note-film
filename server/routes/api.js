import express from 'express';
import { HttpError, now, toInt, normalizeText } from '../util.js';
import { hashPassword, verifyPassword, publicUser, requireUser, requirePremium, requireAdmin, rateLimit } from '../auth.js';
import {
  listTitles,
  listGenres,
  getTitle,
  getSeason,
  getEpisode,
  continueWatching,
  recentEpisodes,
  trending,
  topCommunity,
  topExternal,
  userRatings,
} from '../services/queries.js';
import { recommend } from '../services/recommendations.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;

function parseScore(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new HttpError(400, 'La note doit être un entier entre 1 et 10.');
  return n;
}

export function createApiRouter({ db, config, auth, sync, billing }) {
  const r = express.Router();
  const uid = (req) => req.user?.id || 0;

  // ---------- Configuration publique ----------
  r.get('/config', (_req, res) => {
    res.json({
      appName: config.appName,
      ads: {
        adsenseClient: config.ads.adsenseClient || null,
        slotBanner: config.ads.slotBanner || null,
        slotInfeed: config.ads.slotInfeed || null,
      },
      premium: {
        priceLabel: config.premium.priceLabel,
        stripeEnabled: config.premium.stripeEnabled,
        demoEnabled: config.premium.allowDemo,
      },
      providers: {
        tmdb: Boolean(config.providers.tmdbKey),
        omdb: Boolean(config.providers.omdbKey),
        tvmaze: config.providers.tvmazeEnabled,
      },
    });
  });

  // ---------- Comptes ----------
  const authLimiter = rateLimit({ windowMs: 60_000, max: config.authRateLimit, key: 'auth' });

  r.post('/auth/register', authLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Pseudo : 3 à 24 caractères (lettres, chiffres, « _ », « . », « - »).');
    }
    if (password.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
    if (db.get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'Ce pseudo est déjà pris.');
    const hash = await hashPassword(password);
    const { lastInsertRowid: id } = db.run(
      'INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      email,
      username,
      hash,
      now(),
    );
    auth.startSession(res, id);
    res.status(201).json({ user: publicUser(auth.getUser(id)) });
  });

  r.post('/auth/login', authLimiter, async (req, res) => {
    const login = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    const user = db.get('SELECT * FROM users WHERE email = ? OR username = ?', login.toLowerCase(), login);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, 'Identifiants incorrects.');
    }
    auth.startSession(res, user.id);
    res.json({ user: publicUser(auth.getUser(user.id)) });
  });

  r.post('/auth/logout', (req, res) => {
    auth.endSession(req, res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  r.delete('/me', requireUser, async (req, res) => {
    const password = String(req.body?.password || '');
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!(await verifyPassword(password, user.password_hash))) throw new HttpError(401, 'Mot de passe incorrect.');
    if (user.premium_provider === 'stripe' && req.user.isPremium) {
      throw new HttpError(400, 'Résiliez d’abord votre abonnement Premium avant de supprimer le compte.');
    }
    db.run('DELETE FROM users WHERE id = ?', user.id);
    auth.endSession(req, res);
    res.json({ ok: true });
  });

  r.get('/me/ratings', requireUser, (req, res) => {
    res.json(userRatings(db, req.user.id));
  });

  // ---------- Catalogue ----------
  r.get('/home', (req, res) => {
    const u = uid(req);
    const rec = u ? recommend(db, u, { limit: 16 }) : null;
    res.json({
      continueWatching: continueWatching(db, u),
      recommendations: rec?.personalized ? rec.items : [],
      trendingMovies: trending(db, 'movie', u),
      trendingSeries: trending(db, 'series', u),
      recentEpisodes: recentEpisodes(db),
      topCommunity: topCommunity(db, u),
      topRated: topExternal(db, u),
    });
  });

  r.get('/titles', (req, res) => {
    res.json(
      listTitles(db, {
        type: req.query.type,
        genre: req.query.genre || null,
        sort: req.query.sort,
        page: toInt(req.query.page, 1),
        pageSize: toInt(req.query.pageSize, 24),
        q: req.query.q ? normalizeText(req.query.q) : null,
        userId: uid(req),
      }),
    );
  });

  r.get('/genres', (req, res) => {
    const type = ['movie', 'series'].includes(req.query.type) ? req.query.type : null;
    res.json({ genres: listGenres(db, type) });
  });

  r.get('/titles/:id', (req, res) => {
    const t = getTitle(db, toInt(req.params.id), uid(req));
    if (!t) throw new HttpError(404, 'Titre introuvable.');
    res.json(t);
  });

  r.get('/titles/:id/seasons/:n', (req, res) => {
    const id = toInt(req.params.id);
    if (!db.get(`SELECT 1 FROM titles WHERE id = ? AND type = 'series'`, id)) throw new HttpError(404, 'Série introuvable.');
    res.json(getSeason(db, id, toInt(req.params.n, 1), uid(req)));
  });

  r.get('/episodes/:id', (req, res) => {
    const e = getEpisode(db, toInt(req.params.id), uid(req));
    if (!e) throw new HttpError(404, 'Épisode introuvable.');
    res.json(e);
  });

  r.get('/recommendations', (req, res) => {
    const type = ['movie', 'series'].includes(req.query.type) ? req.query.type : null;
    res.json(recommend(db, uid(req), { limit: Math.min(60, toInt(req.query.limit, 30)), type }));
  });

  // ---------- Notes ----------
  r.put('/titles/:id/rating', requireUser, (req, res) => {
    const id = toInt(req.params.id);
    if (!db.get('SELECT 1 FROM titles WHERE id = ?', id)) throw new HttpError(404, 'Titre introuvable.');
    const score = parseScore(req.body?.score);
    const t = now();
    db.run(
      `INSERT INTO title_ratings (user_id, title_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, title_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
      req.user.id,
      id,
      score,
      t,
      t,
    );
    const c = db.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM title_ratings WHERE title_id = ?', id);
    res.json({ myScore: score, community: { score: Math.round(c.avg * 10) / 10, count: c.n } });
  });

  r.delete('/titles/:id/rating', requireUser, (req, res) => {
    const id = toInt(req.params.id);
    db.run('DELETE FROM title_ratings WHERE user_id = ? AND title_id = ?', req.user.id, id);
    const c = db.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM title_ratings WHERE title_id = ?', id);
    res.json({ myScore: null, community: { score: c.avg == null ? null : Math.round(c.avg * 10) / 10, count: c.n } });
  });

  r.put('/episodes/:id/rating', requireUser, (req, res) => {
    const id = toInt(req.params.id);
    const ep = db.get('SELECT id, title_id FROM episodes WHERE id = ?', id);
    if (!ep) throw new HttpError(404, 'Épisode introuvable.');
    const score = parseScore(req.body?.score);
    const t = now();
    db.run(
      `INSERT INTO episode_ratings (user_id, episode_id, title_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, episode_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
      req.user.id,
      id,
      ep.title_id,
      score,
      t,
      t,
    );
    const c = db.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM episode_ratings WHERE episode_id = ?', id);
    res.json({ myScore: score, community: { score: Math.round(c.avg * 10) / 10, count: c.n } });
  });

  r.delete('/episodes/:id/rating', requireUser, (req, res) => {
    const id = toInt(req.params.id);
    db.run('DELETE FROM episode_ratings WHERE user_id = ? AND episode_id = ?', req.user.id, id);
    const c = db.get('SELECT AVG(score) AS avg, COUNT(*) AS n FROM episode_ratings WHERE episode_id = ?', id);
    res.json({ myScore: null, community: { score: c.avg == null ? null : Math.round(c.avg * 10) / 10, count: c.n } });
  });

  // ---------- Commentaires (lecture pour tous, écriture Premium) ----------
  r.get('/comments', (req, res) => {
    const titleId = toInt(req.query.title);
    const episodeId = toInt(req.query.episode);
    if (!titleId && !episodeId) throw new HttpError(400, 'Paramètre « title » ou « episode » requis.');
    const page = Math.max(1, toInt(req.query.page, 1));
    const rows = db.all(
      `SELECT c.id, c.body, c.spoiler, c.created_at, c.user_id, u.username,
         (u.premium_until > ?) AS premium,
         ${episodeId ? '(SELECT score FROM episode_ratings er WHERE er.user_id = c.user_id AND er.episode_id = c.episode_id)' : '(SELECT score FROM title_ratings tr WHERE tr.user_id = c.user_id AND tr.title_id = c.title_id)'} AS score
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE ${episodeId ? 'c.episode_id = ?' : 'c.title_id = ? AND c.episode_id IS NULL'}
       ORDER BY c.created_at DESC LIMIT 30 OFFSET ?`,
      now(),
      episodeId || titleId,
      (page - 1) * 30,
    );
    const total = db.get(
      `SELECT COUNT(*) AS n FROM comments WHERE ${episodeId ? 'episode_id = ?' : 'title_id = ? AND episode_id IS NULL'}`,
      episodeId || titleId,
    ).n;
    res.json({
      total,
      page,
      items: rows.map((c) => ({
        id: c.id,
        body: c.body,
        spoiler: Boolean(c.spoiler),
        createdAt: c.created_at,
        author: { id: c.user_id, username: c.username, premium: Boolean(c.premium) },
        score: c.score ?? null,
        canDelete: Boolean(req.user && (req.user.id === c.user_id || req.user.isAdmin)),
      })),
    });
  });

  const commentLimiter = rateLimit({ windowMs: 60_000, max: 8, key: 'comment' });

  r.post('/comments', requirePremium, commentLimiter, (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (body.length < 2) throw new HttpError(400, 'Votre commentaire est vide.');
    if (body.length > 2000) throw new HttpError(400, 'Commentaire trop long (2 000 caractères maximum).');
    let titleId = toInt(req.body?.titleId);
    const episodeId = toInt(req.body?.episodeId);
    if (episodeId) {
      const ep = db.get('SELECT title_id FROM episodes WHERE id = ?', episodeId);
      if (!ep) throw new HttpError(404, 'Épisode introuvable.');
      titleId = ep.title_id;
    } else if (!titleId || !db.get('SELECT 1 FROM titles WHERE id = ?', titleId)) {
      throw new HttpError(404, 'Titre introuvable.');
    }
    const { lastInsertRowid: id } = db.run(
      'INSERT INTO comments (user_id, title_id, episode_id, body, spoiler, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id,
      titleId,
      episodeId || null,
      body,
      Boolean(req.body?.spoiler),
      now(),
    );
    res.status(201).json({ id });
  });

  r.delete('/comments/:id', requireUser, (req, res) => {
    const c = db.get('SELECT user_id FROM comments WHERE id = ?', toInt(req.params.id));
    if (!c) throw new HttpError(404, 'Commentaire introuvable.');
    if (c.user_id !== req.user.id && !req.user.isAdmin) throw new HttpError(403, 'Action non autorisée.');
    db.run('DELETE FROM comments WHERE id = ?', toInt(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Recherche & import à la demande ----------
  const remoteLimiter = rateLimit({ windowMs: 60_000, max: 30, key: 'remote' });

  r.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json({ local: [], remote: [] });
    const local = listTitles(db, { q: normalizeText(q), pageSize: 30, userId: uid(req) }).items;
    res.json({ local, remote: [] });
  });

  r.get('/search/remote', remoteLimiter, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.json({ remote: [] });
    try {
      res.json({ remote: await sync.searchRemote(q) });
    } catch (err) {
      res.json({ remote: [], error: err.message });
    }
  });

  r.post('/import', requireUser, remoteLimiter, async (req, res) => {
    const provider = req.body?.provider;
    const providerId = toInt(req.body?.providerId);
    const type = req.body?.type === 'movie' ? 'movie' : 'series';
    if (!['tmdb', 'tvmaze'].includes(provider) || !providerId) throw new HttpError(400, 'Import invalide.');
    const id = await sync.importTitle(provider, providerId, type);
    if (!id) throw new HttpError(404, 'Impossible d’importer ce titre pour le moment.');
    res.status(201).json({ id });
  });

  // ---------- Abonnement ----------
  r.post('/subscription/checkout', requireUser, async (req, res) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ url: await billing.createCheckout(user) });
  });

  r.post('/subscription/portal', requireUser, async (req, res) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    res.json({ url: await billing.createPortal(user) });
  });

  r.post('/subscription/demo', requireUser, (req, res) => {
    billing.activateDemo(req.user.id);
    res.json({ user: publicUser(auth.getUser(req.user.id)) });
  });

  r.post('/subscription/demo/cancel', requireUser, (req, res) => {
    billing.cancelDemo(req.user.id);
    res.json({ user: publicUser(auth.getUser(req.user.id)) });
  });

  // ---------- Administration ----------
  r.get('/admin/status', requireAdmin, (_req, res) => {
    const counts = db.get(
      `SELECT (SELECT COUNT(*) FROM titles WHERE type = 'movie') AS movies,
              (SELECT COUNT(*) FROM titles WHERE type = 'series') AS series,
              (SELECT COUNT(*) FROM episodes) AS episodes,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM users WHERE premium_until > ?) AS premium,
              (SELECT COUNT(*) FROM title_ratings) + (SELECT COUNT(*) FROM episode_ratings) AS ratings,
              (SELECT COUNT(*) FROM comments) AS comments,
              (SELECT COUNT(*) FROM title_external_ratings) + (SELECT COUNT(*) FROM episode_external_ratings) AS externalRatings`,
      now(),
    );
    res.json({ counts, sync: sync.status() });
  });

  r.post('/admin/sync', requireAdmin, (_req, res) => {
    if (sync.status().running) return res.status(202).json({ started: false, running: true });
    sync.run('admin').catch(() => {});
    res.status(202).json({ started: true });
  });

  return r;
}
