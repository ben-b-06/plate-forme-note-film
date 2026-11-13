import { createHttp } from './http.js';
import { createTvmaze } from './tvmaze.js';
import { createTmdb } from './tmdb.js';
import { createOmdb } from './omdb.js';

/** Construit les connecteurs actifs selon la configuration (clés présentes ou non). */
export function createProviders(config, { fetchImpl } = {}) {
  const p = config.providers;
  const ua = `${config.appName.normalize('NFD').replace(/[^\w]/g, '')}/1.0`;
  return {
    // TVmaze : 20 requêtes / 10 s maximum.
    tvmaze: p.tvmazeEnabled
      ? createTvmaze({ http: createHttp({ fetchImpl, minIntervalMs: fetchImpl ? 0 : 550, userAgent: ua }) })
      : null,
    tmdb: p.tmdbKey
      ? createTmdb({
          http: createHttp({ fetchImpl, minIntervalMs: fetchImpl ? 0 : 40, userAgent: ua }),
          apiKey: p.tmdbKey,
          language: p.language,
          region: p.region,
        })
      : null,
    omdb: p.omdbKey
      ? createOmdb({ http: createHttp({ fetchImpl, minIntervalMs: fetchImpl ? 0 : 120, userAgent: ua }), apiKey: p.omdbKey })
      : null,
  };
}
