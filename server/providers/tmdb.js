// TMDB (The Movie Database) : films + séries, en français, tendances, recommandations.
// Clé gratuite : https://www.themoviedb.org/settings/api (clé v3 ou jeton v4 « Bearer »).
import { yearOf } from '../util.js';
import { genresFromTmdbIds } from '../services/genres.js';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const STATUS = {
  'Returning Series': 'En cours',
  Ended: 'Terminée',
  Canceled: 'Annulée',
  'In Production': 'En production',
  Planned: 'Prévue',
  Pilot: 'Pilote',
  Released: 'Sorti',
  'Post Production': 'Post-production',
  Rumored: 'Annoncé',
};

export function createTmdb({ http, apiKey, language = 'fr-FR', region = 'FR', baseUrl = BASE }) {
  const bearer = apiKey.startsWith('eyJ');
  const headers = bearer ? { Authorization: `Bearer ${apiKey}` } : {};

  function url(path, params = {}) {
    const u = new URL(baseUrl + path);
    if (!bearer) u.searchParams.set('api_key', apiKey);
    u.searchParams.set('language', language);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    return u.toString();
  }
  const get = (path, params) => http.getJson(url(path, params), { headers });

  return {
    name: 'tmdb',
    trending: (kind, page = 1) => get(`/trending/${kind}/week`, { page }),
    popular: (kind, page = 1) => get(`/${kind}/popular`, { page, region }),
    details: (kind, id) => get(`/${kind}/${id}`, { append_to_response: 'external_ids,recommendations' }),
    season: (tvId, n) => get(`/tv/${tvId}/season/${n}`),
    find: (imdbId) => get(`/find/${imdbId}`, { external_source: 'imdb_id' }),
    search: (q) => get('/search/multi', { query: q, include_adult: 'false' }),
  };
}

const img = (path, size) => (path ? `${IMG}/${size}${path}` : null);

/** Popularité TMDB (non bornée) ramenée sur ~0-100. */
export function normalizeTmdbPopularity(p) {
  return Math.min(100, Math.round(25 * Math.log10(1 + (p || 0)) * 10) / 10);
}

function ratingOf(o, kind) {
  if (!o.vote_count || o.vote_average == null) return null;
  return {
    score: Math.round(o.vote_average * 10) / 10,
    display: `${o.vote_average.toFixed(1)}/10`,
    votes: o.vote_count,
    url: kind && o.id ? `https://www.themoviedb.org/${kind}/${o.id}` : null,
  };
}

/** Objet de liste TMDB (tendances, populaires, recommandations) → titre basique. */
export function mapTmdbListItem(o, kindHint) {
  const kind = o.media_type || kindHint;
  if (kind !== 'movie' && kind !== 'tv') return null;
  const isMovie = kind === 'movie';
  const date = isMovie ? o.release_date : o.first_air_date;
  return {
    title: {
      type: isMovie ? 'movie' : 'series',
      title: isMovie ? o.title : o.name,
      original_title: isMovie ? o.original_title : o.original_name,
      overview: o.overview || null,
      year: yearOf(date),
      release_date: date || null,
      poster_url: img(o.poster_path, 'w342'),
      poster_large_url: img(o.poster_path, 'w780'),
      backdrop_url: img(o.backdrop_path, 'w1280'),
      genres: genresFromTmdbIds(o.genre_ids || []),
      tmdb_id: o.id,
      popularity: normalizeTmdbPopularity(o.popularity),
    },
    rating: ratingOf(o, kind),
  };
}

/** Détails TMDB (avec external_ids, recommendations) → bundle complet. */
export function mapTmdbDetails(d, kind) {
  const isMovie = kind === 'movie';
  const date = isMovie ? d.release_date : d.first_air_date;
  const title = {
    type: isMovie ? 'movie' : 'series',
    title: isMovie ? d.title : d.name,
    original_title: isMovie ? d.original_title : d.original_name,
    overview: d.overview || null,
    year: yearOf(date),
    end_year: !isMovie && d.status === 'Ended' ? yearOf(d.last_air_date) : null,
    release_date: date || null,
    runtime: isMovie ? d.runtime || null : d.episode_run_time?.[0] || null,
    status: STATUS[d.status] || d.status || null,
    poster_url: img(d.poster_path, 'w342'),
    poster_large_url: img(d.poster_path, 'w780'),
    backdrop_url: img(d.backdrop_path, 'w1280'),
    genres: genresFromTmdbIds((d.genres || []).map((g) => g.id)),
    network: !isMovie ? d.networks?.[0]?.name || null : null,
    imdb_id: d.imdb_id || d.external_ids?.imdb_id || null,
    tmdb_id: d.id,
    popularity: normalizeTmdbPopularity(d.popularity),
  };
  const seasons = isMovie
    ? []
    : (d.seasons || [])
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          season_number: s.season_number,
          name: s.name || `Saison ${s.season_number}`,
          overview: s.overview || null,
          poster_url: img(s.poster_path, 'w342'),
          air_date: s.air_date || null,
          episode_count: s.episode_count || null,
        }));
  const recommendations = (d.recommendations?.results || [])
    .slice(0, 12)
    .map((r) => mapTmdbListItem(r, kind))
    .filter(Boolean);
  return { title, rating: ratingOf(d, kind), seasons, recommendations };
}

export function mapTmdbSeason(s) {
  return (s.episodes || [])
    .filter((e) => e.episode_number != null)
    .map((e) => ({
      season_number: e.season_number,
      episode_number: e.episode_number,
      name: e.name || null,
      overview: e.overview || null,
      air_date: e.air_date || null,
      runtime: e.runtime || null,
      still_url: img(e.still_path, 'w300'),
      tmdb_id: e.id,
      rating: ratingOf(e, null),
    }));
}

export function mapTmdbSearchResult(o) {
  const m = mapTmdbListItem(o);
  if (!m) return null;
  return {
    provider: 'tmdb',
    providerId: o.id,
    type: m.title.type,
    title: m.title.title,
    year: m.title.year,
    poster: m.title.poster_url,
  };
}
