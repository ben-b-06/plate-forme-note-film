// TVmaze : séries, saisons, épisodes et notes — API gratuite, sans clé.
// Données sous licence CC BY-SA (attribution affichée dans l'app).
import { stripHtml, yearOf, toInt } from '../util.js';
import { genresFromTvmaze } from '../services/genres.js';

const BASE = 'https://api.tvmaze.com';

const STATUS = {
  Running: 'En cours',
  Ended: 'Terminée',
  'To Be Determined': 'Indéterminé',
  'In Development': 'En développement',
};

export function createTvmaze({ http, baseUrl = BASE }) {
  return {
    name: 'tvmaze',
    lookupImdb: (imdbId) => http.getJson(`${baseUrl}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`),
    show: (id) => http.getJson(`${baseUrl}/shows/${id}?embed%5B%5D=seasons&embed%5B%5D=episodes`),
    search: async (q) => (await http.getJson(`${baseUrl}/search/shows?q=${encodeURIComponent(q)}`)) || [],
    updates: async (since = 'week') => (await http.getJson(`${baseUrl}/updates/shows?since=${since}`)) || {},
    schedule: async (country, date) =>
      (await http.getJson(`${baseUrl}/schedule?country=${encodeURIComponent(country)}&date=${date}`)) || [],
    webSchedule: async (date) => (await http.getJson(`${baseUrl}/schedule/web?date=${date}`)) || [],
  };
}

function largeImage(url) {
  return url ? url.replace('/medium_portrait/', '/original_untouched/') : null;
}

/** Convertit une fiche série TVmaze (avec _embedded) en « bundle » pour le catalogue. */
export function mapTvmazeShow(show) {
  const emb = show._embedded || {};
  const title = {
    type: 'series',
    title: show.name,
    original_title: show.name,
    overview: stripHtml(show.summary),
    year: yearOf(show.premiered),
    end_year: yearOf(show.ended),
    release_date: show.premiered || null,
    runtime: show.averageRuntime || show.runtime || null,
    status: STATUS[show.status] || show.status || null,
    poster_url: show.image?.medium || null,
    poster_large_url: show.image?.original || largeImage(show.image?.medium),
    genres: genresFromTvmaze(show.genres || []),
    network: show.network?.name || show.webChannel?.name || null,
    imdb_id: show.externals?.imdb || null,
    tvmaze_id: show.id,
    popularity: show.weight ?? null,
  };
  const rating =
    show.rating?.average != null
      ? { score: show.rating.average, display: `${show.rating.average}/10`, url: show.url || null }
      : null;

  const seasons = (emb.seasons || [])
    .filter((s) => toInt(s.number) > 0)
    .map((s) => ({
      season_number: s.number,
      name: s.name || `Saison ${s.number}`,
      overview: stripHtml(s.summary),
      poster_url: s.image?.medium || null,
      air_date: s.premiereDate || null,
      episode_count: s.episodeOrder || null,
    }));

  const episodes = (emb.episodes || [])
    .filter((e) => e.number != null && toInt(e.season) > 0 && (e.type == null || e.type === 'regular'))
    .map((e) => ({
      season_number: e.season,
      episode_number: e.number,
      name: e.name || null,
      overview: stripHtml(e.summary),
      air_date: e.airdate || null,
      runtime: e.runtime || null,
      still_url: e.image?.medium || null,
      tvmaze_id: e.id,
      rating:
        e.rating?.average != null
          ? { score: e.rating.average, display: `${e.rating.average}/10`, url: e.url || null }
          : null,
    }));

  return { title, rating, seasons, episodes };
}

/** Résultat de recherche TVmaze → suggestion d'import. */
export function mapTvmazeSearchResult(r) {
  const s = r.show || r;
  return {
    provider: 'tvmaze',
    providerId: s.id,
    type: 'series',
    title: s.name,
    year: yearOf(s.premiered),
    poster: s.image?.medium || null,
    imdbId: s.externals?.imdb || null,
  };
}
