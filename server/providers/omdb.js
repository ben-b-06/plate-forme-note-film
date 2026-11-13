// OMDb : notes IMDb, Rotten Tomatoes et Metacritic (+ notes IMDb par épisode).
// Clé gratuite (1 000 requêtes/jour) : https://www.omdbapi.com/apikey.aspx
const BASE = 'https://www.omdbapi.com/';

export function createOmdb({ http, apiKey, baseUrl = BASE }) {
  const get = async (params) => {
    const u = new URL(baseUrl);
    u.searchParams.set('apikey', apiKey);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const data = await http.getJson(u.toString());
    if (!data || data.Response === 'False') return null;
    return data;
  };
  return {
    name: 'omdb',
    byImdb: (imdbId) => get({ i: imdbId, plot: 'short' }),
    season: (imdbId, n) => get({ i: imdbId, Season: String(n) }),
  };
}

const num = (s) => {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Extrait les notes { imdb, rotten_tomatoes, metacritic } d'une réponse OMDb. */
export function mapOmdbRatings(data) {
  if (!data) return {};
  const out = {};
  const imdbUrl = data.imdbID ? `https://www.imdb.com/title/${data.imdbID}/` : null;
  const votes = parseInt(String(data.imdbVotes || '').replace(/[^\d]/g, ''), 10) || null;

  for (const r of data.Ratings || []) {
    if (r.Source === 'Internet Movie Database') {
      const v = num(r.Value.split('/')[0]);
      if (v != null) out.imdb = { score: v, display: `${v}/10`, votes, url: imdbUrl };
    } else if (r.Source === 'Rotten Tomatoes') {
      const v = num(r.Value);
      if (v != null) out.rotten_tomatoes = { score: v / 10, display: `${v}%`, url: null };
    } else if (r.Source === 'Metacritic') {
      const v = num(r.Value.split('/')[0]);
      if (v != null) out.metacritic = { score: v / 10, display: `${v}/100`, url: null };
    }
  }
  if (!out.imdb && data.imdbRating && data.imdbRating !== 'N/A') {
    const v = num(data.imdbRating);
    if (v != null) out.imdb = { score: v, display: `${v}/10`, votes, url: imdbUrl };
  }
  if (!out.metacritic && data.Metascore && data.Metascore !== 'N/A') {
    const v = num(data.Metascore);
    if (v != null) out.metacritic = { score: v / 10, display: `${v}/100`, url: null };
  }
  return out;
}

/** Notes IMDb des épisodes d'une saison : [{ episode_number, imdb_id, rating }]. */
export function mapOmdbSeason(data) {
  if (!data?.Episodes) return [];
  return data.Episodes.map((e) => {
    const v = num(e.imdbRating);
    return {
      episode_number: parseInt(e.Episode, 10),
      imdb_id: e.imdbID || null,
      rating:
        v != null
          ? { score: v, display: `${v}/10`, url: e.imdbID ? `https://www.imdb.com/title/${e.imdbID}/` : null }
          : null,
    };
  }).filter((e) => Number.isFinite(e.episode_number));
}
