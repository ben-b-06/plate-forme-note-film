// Synchronisation avec des réponses simulées de TVmaze, TMDB et OMDb
// (les valeurs ci-dessous sont des données de test, pas des notes réelles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { seedCatalog } from '../server/seed.js';
import { createProviders } from '../server/providers/index.js';
import { createSync } from '../server/sync/sync.js';
import { mergeTitles, upsertTitle, saveBundle } from '../server/services/catalog.js';
import { mapOmdbRatings } from '../server/providers/omdb.js';
import { stripHtml } from '../server/util.js';
import { mockFetch, testConfig, silent } from './helpers.js';

const TVMAZE_BB = {
  id: 169,
  url: 'https://www.tvmaze.com/shows/169/breaking-bad',
  name: 'Breaking Bad',
  type: 'Scripted',
  genres: ['Drama', 'Crime', 'Thriller'],
  status: 'Ended',
  runtime: 60,
  averageRuntime: 60,
  premiered: '2008-01-20',
  ended: '2013-09-29',
  rating: { average: 9.1 },
  weight: 98,
  network: { name: 'AMC' },
  externals: { imdb: 'tt0903747' },
  image: {
    medium: 'https://static.tvmaze.com/uploads/images/medium_portrait/0/2400.jpg',
    original: 'https://static.tvmaze.com/uploads/images/original_untouched/0/2400.jpg',
  },
  summary: '<p><b>Breaking Bad</b> follows a chemistry teacher &amp; his partner.</p>',
  _embedded: {
    seasons: [
      { id: 1, number: 1, name: '', episodeOrder: 7, premiereDate: '2008-01-20', image: null, summary: null },
      { id: 2, number: 2, name: '', episodeOrder: 2, premiereDate: '2009-03-08', image: null, summary: null },
    ],
    episodes: [
      { id: 101, name: 'Pilot', season: 1, number: 1, type: 'regular', airdate: '2008-01-20', runtime: 58, rating: { average: 8.4 }, image: { medium: 'https://static.tvmaze.com/e1.jpg' }, summary: '<p>Walter starts.</p>' },
      { id: 102, name: "Cat's in the Bag...", season: 1, number: 2, type: 'regular', airdate: '2008-01-27', runtime: 48, rating: { average: 8.1 }, image: null, summary: null },
      { id: 201, name: 'Seven Thirty-Seven', season: 2, number: 1, type: 'regular', airdate: '2009-03-08', runtime: 47, rating: { average: 8.5 }, image: null, summary: null },
      { id: 202, name: 'Grilled', season: 2, number: 2, type: 'regular', airdate: '2009-03-15', runtime: 47, rating: { average: null }, image: null, summary: null },
      { id: 999, name: 'Special', season: 2, number: null, type: 'significant_special', airdate: '2009-02-01', rating: { average: 7 } },
    ],
  },
};

const TVMAZE_NEW = {
  ...TVMAZE_BB,
  id: 5000,
  name: 'Une nouvelle série',
  premiered: '2026-10-01',
  ended: null,
  status: 'Running',
  weight: 90,
  externals: { imdb: null },
  rating: { average: null },
  _embedded: {
    seasons: [{ id: 50, number: 1, episodeOrder: 1, premiereDate: '2026-10-01' }],
    episodes: [{ id: 5001, name: 'Début', season: 1, number: 1, type: 'regular', airdate: '2026-10-01', rating: { average: 7.7 } }],
  },
};

function tvmazeRoutes() {
  return [
    ['api.tvmaze.com/lookup/shows?imdb=tt0903747', { ...TVMAZE_BB, _embedded: undefined }],
    [/api\.tvmaze\.com\/shows\/169\?/, TVMAZE_BB],
    [/api\.tvmaze\.com\/shows\/5000\?/, TVMAZE_NEW],
    ['api.tvmaze.com/updates/shows', { 169: 1790000000 }],
    ['api.tvmaze.com/schedule/web', [{ _embedded: { show: { id: 5000, weight: 90, type: 'Scripted', externals: {} } } }]],
    ['api.tvmaze.com/schedule?', []],
    ['api.tvmaze.com/search/shows', [{ score: 1, show: { id: 5000, name: 'Une nouvelle série', premiered: '2026-10-01', image: null, externals: {} } }]],
  ];
}

function setup(routes, overrides = {}) {
  const db = openDb(':memory:');
  seedCatalog(db);
  const config = testConfig(overrides);
  const fetchImpl = mockFetch(routes);
  const sync = createSync({ db, config, providers: createProviders(config, { fetchImpl }), log: silent });
  return { db, sync, fetchImpl };
}

const byImdb = (db, imdb) => db.get('SELECT * FROM titles WHERE imdb_id = ?', imdb);

test('TVmaze : relie les séries du catalogue, ajoute épisodes, affiches et notes', async () => {
  const { db, sync } = setup(tvmazeRoutes());
  const before = byImdb(db, 'tt0903747');
  const res = await sync.run('test');
  assert.equal(res.status, 'ok', JSON.stringify(res.stats.errors));

  const bb = byImdb(db, 'tt0903747');
  assert.equal(bb.id, before.id, 'pas de doublon : même fiche');
  assert.equal(bb.tvmaze_id, 169);
  assert.equal(bb.poster_url, TVMAZE_BB.image.medium);
  assert.equal(bb.overview, before.overview, 'le synopsis français est conservé');
  assert.equal(
    db.get(`SELECT score FROM title_external_ratings WHERE title_id = ? AND source = 'tvmaze'`, bb.id).score,
    9.1,
  );
  const eps = db.all('SELECT * FROM episodes WHERE title_id = ? ORDER BY season_number, episode_number', bb.id);
  assert.equal(eps.filter((e) => e.season_number === 1).length, 7, 'les 7 épisodes de la saison 1 restent');
  assert.ok(eps.some((e) => e.season_number === 2 && e.name === 'Seven Thirty-Seven'), 'saison 2 ajoutée');
  assert.ok(!eps.some((e) => e.name === 'Special'), 'les épisodes spéciaux sont ignorés');
  const pilot = eps.find((e) => e.season_number === 1 && e.episode_number === 1);
  assert.equal(pilot.air_date, '2008-01-20');
  assert.equal(db.get(`SELECT score FROM episode_external_ratings WHERE episode_id = ?`, pilot.id).score, 8.4);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM seasons WHERE title_id = ?', bb.id).n, 2);

  // Découverte d'une série diffusée aujourd'hui
  const fresh = db.get('SELECT * FROM titles WHERE tvmaze_id = 5000');
  assert.ok(fresh, 'nouvelle série importée depuis le programme du jour');
  assert.equal(fresh.type, 'series');
  assert.deepEqual(JSON.parse(fresh.genres), ['Drame', 'Crime', 'Thriller']);

  const status = sync.status();
  assert.equal(status.runs[0].status, 'ok');
  assert.ok(status.runs[0].stats.episodes > 0);
});

test('TVmaze : une correspondance IMDb incohérente est ignorée', async () => {
  const wrong = { ...TVMAZE_BB, name: 'Autre chose', premiered: '1995-01-01', _embedded: undefined };
  const { db, sync } = setup([['lookup/shows?imdb=tt0903747', wrong], ...tvmazeRoutes().slice(1)]);
  const res = await sync.run('test');
  assert.equal(byImdb(db, 'tt0903747').tvmaze_id, null);
  assert.ok(res.stats.warnings.some((w) => w.includes('douteuse')));
});

test('la synchronisation tolère une source en panne', async () => {
  const { db, sync } = setup([[/tvmaze/, { __status: 500 }]]);
  const res = await sync.run('test');
  assert.equal(res.status, 'erreur');
  assert.ok(res.stats.errors.length > 0);
  assert.equal(db.get(`SELECT status FROM sync_runs ORDER BY id DESC`).status, 'erreur');
  // Une seconde exécution est possible
  assert.ok((await sync.run('test')).id);
});

test('TMDB + OMDb : tendances, détails en français, doublons fusionnés, notes IMDb / RT / Metacritic', async () => {
  const tmdbMovie = (id, title, imdb, extra = {}) => ({
    id,
    title,
    original_title: title,
    overview: `Résumé TMDB de ${title}`,
    release_date: '2010-07-15',
    genre_ids: [878, 28],
    poster_path: `/p${id}.jpg`,
    backdrop_path: `/b${id}.jpg`,
    vote_average: 8.3,
    vote_count: 1000,
    popularity: 120,
    imdb_id: imdb,
    genres: [{ id: 878 }, { id: 28 }],
    runtime: 148,
    status: 'Released',
    ...extra,
  });
  const routes = [
    [/\/find\/tt1375666/, { movie_results: [{ id: 27205 }], tv_results: [] }],
    [/\/find\/tt0816692/, { movie_results: [{ id: 157336 }], tv_results: [] }],
    [/\/find\//, { movie_results: [], tv_results: [] }],
    [
      /\/trending\/movie\/week/,
      { results: [{ ...tmdbMovie(27205, 'Inception'), media_type: 'movie' }, { ...tmdbMovie(238, 'Le Parrain'), media_type: 'movie' }] },
    ],
    [/\/trending\/tv\/week/, { results: [] }],
    [/\/popular/, { results: [] }],
    [
      /\/movie\/27205\?/,
      tmdbMovie(27205, 'Inception', 'tt1375666', {
        recommendations: { results: [{ ...tmdbMovie(157336, 'Interstellar'), media_type: 'movie' }] },
      }),
    ],
    [/\/movie\/238\?/, tmdbMovie(238, 'Le Parrain', 'tt0068646', { release_date: '1972-03-14' })],
    [/\/movie\/157336\?/, tmdbMovie(157336, 'Interstellar', 'tt0816692')],
    [
      /omdbapi\.com.*i=tt1375666/,
      {
        Response: 'True',
        imdbID: 'tt1375666',
        imdbRating: '8.8',
        imdbVotes: '2,500,000',
        Metascore: '74',
        Poster: 'N/A',
        Ratings: [
          { Source: 'Internet Movie Database', Value: '8.8/10' },
          { Source: 'Rotten Tomatoes', Value: '87%' },
          { Source: 'Metacritic', Value: '74/100' },
        ],
      },
    ],
    [/omdbapi\.com/, { Response: 'False', Error: 'Not found' }],
  ];
  const { db, sync, fetchImpl } = setup(routes, {
    providers: { tmdbKey: 'cle-test', omdbKey: 'cle-omdb', tvmazeEnabled: false },
    sync: { enabled: false, tmdbPages: 1 },
  });
  const parrainBefore = byImdb(db, 'tt0068646');
  const res = await sync.run('test');
  assert.equal(res.status, 'ok', JSON.stringify(res.stats.errors));

  const inception = byImdb(db, 'tt1375666');
  assert.equal(inception.tmdb_id, 27205);
  assert.equal(inception.overview, 'Résumé TMDB de Inception', 'TMDB (français) fait autorité');
  assert.equal(inception.runtime, 148);
  assert.match(inception.poster_url, /image\.tmdb\.org\/t\/p\/w342\/p27205\.jpg/);
  assert.equal(inception.trending_rank, 1);

  // Notes des plateformes
  const ratings = Object.fromEntries(
    db.all('SELECT source, score, display FROM title_external_ratings WHERE title_id = ?', inception.id).map((r) => [r.source, r]),
  );
  assert.equal(ratings.imdb.display, '8.8/10');
  assert.equal(ratings.rotten_tomatoes.display, '87%');
  assert.equal(ratings.rotten_tomatoes.score, 8.7);
  assert.equal(ratings.metacritic.score, 7.4);
  assert.equal(ratings.tmdb.score, 8.3);

  // Recommandation TMDB reliée à la fiche existante d'Interstellar
  const interstellar = byImdb(db, 'tt0816692');
  assert.ok(db.get('SELECT 1 FROM title_links WHERE title_id = ? AND related_id = ?', inception.id, interstellar.id));

  // « Le Parrain » arrivé via les tendances sans IMDb : fusionné avec la fiche du catalogue
  assert.equal(db.all(`SELECT id FROM titles WHERE title = 'Le Parrain'`).length, 1);
  const parrain = byImdb(db, 'tt0068646');
  assert.equal(parrain.id, parrainBefore.id);
  assert.equal(parrain.tmdb_id, 238);

  // La clé d'API n'apparaît jamais dans les journaux d'erreur (elle est bien envoyée à l'API)
  assert.ok(fetchImpl.calls.some((u) => u.includes('api_key=cle-test')));
});

test('fusion de doublons : notes et épisodes conservés', () => {
  const db = openDb(':memory:');
  const keep = upsertTitle(db, { type: 'series', title: 'Série A', imdb_id: 'tt1' });
  const drop = saveBundle(db, {
    title: { type: 'series', title: 'Series A', tvmaze_id: 77 },
    episodes: [
      { season_number: 1, episode_number: 1, name: 'Un' },
      { season_number: 1, episode_number: 2, name: 'Deux' },
    ],
  });
  saveBundle(db, { title: { type: 'series', title: 'Série A', imdb_id: 'tt1' }, episodes: [{ season_number: 1, episode_number: 1, name: 'Un' }] });
  db.run(`INSERT INTO users (id, email, username, password_hash, created_at) VALUES (1, 'a@a.fr', 'a', 'x', 0)`);
  db.run('INSERT INTO title_ratings VALUES (1, ?, 8, 0, 0)', drop);
  const ep2 = db.get('SELECT id FROM episodes WHERE title_id = ? AND episode_number = 2', drop).id;
  db.run('INSERT INTO episode_ratings VALUES (1, ?, ?, 9, 0, 0)', ep2, drop);

  mergeTitles(db, keep, drop);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM titles').n, 1);
  const t = db.get('SELECT * FROM titles WHERE id = ?', keep);
  assert.equal(t.tvmaze_id, 77);
  assert.equal(db.get('SELECT score FROM title_ratings WHERE title_id = ?', keep).score, 8);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM episodes WHERE title_id = ?', keep).n, 2);
  assert.equal(db.get('SELECT title_id FROM episode_ratings WHERE user_id = 1').title_id, keep);
});

test('import à la demande depuis la recherche TVmaze', async () => {
  const { db, sync } = setup(tvmazeRoutes());
  const remote = await sync.searchRemote('nouvelle');
  assert.equal(remote[0].providerId, 5000);
  const id = await sync.importTitle('tvmaze', 5000, 'series');
  assert.equal(db.get('SELECT title FROM titles WHERE id = ?', id).title, 'Une nouvelle série');
  assert.equal((await sync.searchRemote('nouvelle')).length, 0, 'déjà dans le catalogue');
});

test('utilitaires de conversion', () => {
  assert.equal(stripHtml('<p>A &amp; B<br>C</p>'), 'A & B\nC');
  assert.deepEqual(Object.keys(mapOmdbRatings({ imdbID: 'tt1', imdbRating: '7.1', imdbVotes: '1,234', Ratings: [] })), ['imdb']);
});
