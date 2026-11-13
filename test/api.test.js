import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, testConfig } from './helpers.js';

let app;
before(async () => {
  app = await startApp({ config: testConfig({ adminEmails: ['admin@exemple.fr'] }) });
});
after(() => app.close());

const seriesId = () => app.db.get(`SELECT id FROM titles WHERE imdb_id = 'tt0903747'`).id; // Breaking Bad
const movieId = (imdb) => app.db.get('SELECT id FROM titles WHERE imdb_id = ?', imdb).id;

test('catalogue de départ : films, séries et épisodes', async () => {
  const c = app.client();
  const movies = await c.get('/api/titles?type=movie');
  const series = await c.get('/api/titles?type=series');
  assert.equal(movies.status, 200);
  assert.ok(movies.data.total >= 30);
  assert.ok(series.data.total >= 20);
  const bb = await c.get(`/api/titles/${seriesId()}`);
  assert.equal(bb.data.title, 'Breaking Bad');
  assert.equal(bb.data.seasons[0].episodeCount, 7);
  const s1 = await c.get(`/api/titles/${seriesId()}/seasons/1`);
  assert.equal(s1.data.episodes[0].name, 'Pilot');
});

test('recherche sans accents et filtre par genre', async () => {
  const c = app.client();
  const r = await c.get('/api/search?q=amelie');
  assert.ok(r.data.local.some((t) => t.title.includes('Amélie')));
  const g = await c.get(`/api/titles?type=movie&genre=${encodeURIComponent('Animation')}`);
  assert.ok(g.data.items.length > 0);
  assert.ok(g.data.items.every((t) => t.genres.includes('Animation')));
});

test('inscription, connexion, session et doublons', async () => {
  const c = app.client();
  const r = await c.register('bob');
  assert.equal(r.status, 201);
  assert.equal(r.data.user.username, 'bob');
  assert.equal(r.data.user.isPremium, false);
  assert.equal((await c.get('/api/me')).data.user.username, 'bob');

  const dup = await app.client().register('bob', 'autre@exemple.fr');
  assert.equal(dup.status, 409);
  const bad = await app.client().post('/api/auth/login', { email: 'bob@exemple.fr', password: 'mauvais' });
  assert.equal(bad.status, 401);
  const ok = await app.client().post('/api/auth/login', { email: 'bob', password: 'motdepasse' });
  assert.equal(ok.status, 200);

  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).data.user, null);
});

test('les mots de passe ne sont jamais stockés en clair', () => {
  const u = app.db.get(`SELECT password_hash FROM users WHERE username = 'bob'`);
  assert.match(u.password_hash, /^scrypt\$/);
  assert.ok(!u.password_hash.includes('motdepasse'));
});

test('protection CSRF : écriture refusée sans en-tête X-Requested-With', async () => {
  const c = app.client();
  await c.register('carol');
  const r = await c.put(`/api/titles/${movieId('tt1375666')}/rating`, { score: 8 }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
});

test('noter un film, une série et des épisodes', async () => {
  const c = app.client();
  assert.equal((await c.put(`/api/titles/${movieId('tt1375666')}/rating`, { score: 9 })).status, 401);
  await c.register('dave');
  const r = await c.put(`/api/titles/${movieId('tt1375666')}/rating`, { score: 9 });
  assert.equal(r.status, 200);
  assert.equal(r.data.myScore, 9);
  assert.equal((await c.put(`/api/titles/${movieId('tt1375666')}/rating`, { score: 11 })).status, 400);
  assert.equal((await c.put(`/api/titles/${movieId('tt1375666')}/rating`, { score: 7.5 })).status, 400);

  const s1 = (await c.get(`/api/titles/${seriesId()}/seasons/1`)).data;
  for (const [i, score] of [10, 8, 6].entries()) {
    const e = await c.put(`/api/episodes/${s1.episodes[i].id}/rating`, { score });
    assert.equal(e.status, 200);
  }
  const bb = (await c.get(`/api/titles/${seriesId()}`)).data;
  assert.equal(bb.myEpisodes.count, 3);
  assert.equal(bb.myEpisodes.score, 8);
  assert.equal(bb.seasons[0].myRatedCount, 3);

  // « Reprendre vos séries » propose l'épisode 4.
  const home = (await c.get('/api/home')).data;
  assert.equal(home.continueWatching[0].episode.number, 4);

  // Retirer une note
  const del = await c.del(`/api/episodes/${s1.episodes[2].id}/rating`);
  assert.equal(del.data.myScore, null);
  const me = (await c.get('/api/me/ratings')).data;
  assert.equal(me.stats.episodes, 2);
  assert.equal(me.stats.titles, 1);
});

test('recommandations basées sur les titres aimés', async () => {
  const c = app.client();
  await c.register('emma');
  const cold = (await c.get('/api/recommendations')).data;
  assert.equal(cold.personalized, false);
  assert.ok(cold.items.length > 0);

  // Emma adore la science-fiction et déteste la comédie romantique.
  for (const imdb of ['tt1375666', 'tt0816692', 'tt0133093']) {
    await c.put(`/api/titles/${movieId(imdb)}/rating`, { score: 10 });
  }
  await c.put(`/api/titles/${movieId('tt0211915')}/rating`, { score: 2 });
  const rec = (await c.get('/api/recommendations?type=movie&limit=8')).data;
  assert.equal(rec.personalized, true);
  const rated = new Set(['tt1375666', 'tt0816692', 'tt0133093', 'tt0211915'].map(movieId));
  assert.ok(rec.items.every((t) => !rated.has(t.id)), 'les titres déjà notés sont exclus');
  const sf = rec.items.slice(0, 5).filter((t) => t.genres.includes('Science-fiction')).length;
  assert.ok(sf >= 3, `la SF doit dominer le haut du classement (${sf}/5)`);
  assert.ok(rec.items.every((t) => t.reason?.text));
});

test('recommandations collaboratives (« les fans de… »)', async () => {
  // Trois membres aiment Whiplash et La La Land.
  const whiplash = movieId('tt2582802');
  const lalaland = movieId('tt3783958');
  for (const name of ['fan1', 'fan2', 'fan3']) {
    const c = app.client();
    await c.register(name);
    await c.put(`/api/titles/${whiplash}/rating`, { score: 9 });
    await c.put(`/api/titles/${lalaland}/rating`, { score: 9 });
  }
  const me = app.client();
  await me.register('nouveau');
  await me.put(`/api/titles/${whiplash}/rating`, { score: 10 });
  const rec = (await me.get('/api/recommendations?limit=5')).data;
  const top = rec.items.find((t) => t.id === lalaland);
  assert.ok(top, 'La La Land doit être recommandé');
  assert.equal(top.reason.kind, 'collab');
});

test('commentaires : lecture pour tous, écriture réservée au Premium', async () => {
  const c = app.client();
  await c.register('fiona');
  const id = movieId('tt6751668');
  const denied = await c.post('/api/comments', { titleId: id, body: 'Chef-d’œuvre !' });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'premium_required');

  // Abonnement (mode démo, Stripe non configuré en test)
  const sub = await c.post('/api/subscription/demo');
  assert.equal(sub.data.user.isPremium, true);

  const ok = await c.post('/api/comments', { titleId: id, body: '<script>alert(1)</script> Chef-d’œuvre !' });
  assert.equal(ok.status, 201);
  const list = (await app.client().get(`/api/comments?title=${id}`)).data;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].author.username, 'fiona');
  assert.equal(list.items[0].canDelete, false);
  assert.equal((await c.get(`/api/comments?title=${id}`)).data.items[0].canDelete, true);

  // Un autre membre ne peut pas supprimer le commentaire
  const other = app.client();
  await other.register('gaston');
  assert.equal((await other.del(`/api/comments/${ok.data.id}`)).status, 403);
  assert.equal((await c.del(`/api/comments/${ok.data.id}`)).status, 200);

  // Commentaire sur un épisode
  const ep = app.db.get('SELECT id FROM episodes LIMIT 1').id;
  assert.equal((await c.post('/api/comments', { episodeId: ep, body: 'Quel épisode !', spoiler: true })).status, 201);
  const epList = (await c.get(`/api/comments?episode=${ep}`)).data;
  assert.equal(epList.items[0].spoiler, true);

  // Arrêt du Premium démo → plus de commentaires
  await c.post('/api/subscription/demo/cancel');
  assert.equal((await c.post('/api/comments', { titleId: id, body: 'encore' })).status, 403);
});

test('administration réservée aux e-mails ADMIN_EMAILS', async () => {
  const c = app.client();
  await c.register('lambda');
  assert.equal((await c.get('/api/admin/status')).status, 403);
  const admin = app.client();
  await admin.register('admin', 'admin@exemple.fr');
  const s = await admin.get('/api/admin/status');
  assert.equal(s.status, 200);
  assert.ok(s.data.counts.movies > 0);
  assert.equal(s.data.sync.providers.tvmaze, true);
});

test('suppression du compte (RGPD)', async () => {
  const c = app.client();
  const { data } = await c.register('temp');
  await c.put(`/api/titles/${movieId('tt1375666')}/rating`, { score: 5 });
  assert.equal((await c.del('/api/me', { password: 'faux' })).status, 401);
  assert.equal((await c.del('/api/me', { password: 'motdepasse' })).status, 200);
  assert.equal(app.db.get('SELECT COUNT(*) AS n FROM title_ratings WHERE user_id = ?', data.user.id).n, 0);
  assert.equal((await c.get('/api/me')).data.user, null);
});

test('pages de l’application monopage et en-têtes de sécurité', async () => {
  const res = await fetch(`${app.base}/titre/1`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<main id="view"/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(`${app.base}/api/inconnu`)).status, 404);
  assert.equal((await fetch(`${app.base}/manifest.webmanifest`)).status, 200);
  assert.equal((await fetch(`${app.base}/sw.js`)).status, 200);
});
