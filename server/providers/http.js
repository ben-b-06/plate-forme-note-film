// Client HTTP JSON minimal : délai max, nouvelles tentatives (429/5xx), espacement des requêtes.
import { sleep } from '../util.js';

export class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createHttp({ fetchImpl = globalThis.fetch, minIntervalMs = 0, timeoutMs = 15000, retries = 2, userAgent } = {}) {
  let last = 0;
  let queue = Promise.resolve();

  // Sérialise l'espacement minimal entre deux requêtes (respect des quotas des API).
  function slot() {
    const p = queue.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    queue = p.catch(() => {});
    return p;
  }

  async function getJson(url, { headers = {}, allow404 = true } = {}) {
    for (let attempt = 0; ; attempt++) {
      await slot();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': userAgent || 'CineNote/1.0', ...headers },
          signal: ctrl.signal,
          redirect: 'follow',
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new ProviderError(`Réseau indisponible (${err.message})`, 0);
      }
      clearTimeout(timer);
      if (res.status === 404 && allow404) return null;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get?.('retry-after')) || 0;
        await sleep(Math.max(retryAfter * 1000, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new ProviderError(`HTTP ${res.status} sur ${redact(url)}`, res.status);
      return res.json();
    }
  }

  return { getJson };
}

// Ne jamais écrire les clés d'API dans les journaux.
export function redact(url) {
  return String(url).replace(/(api_key|apikey)=[^&]+/gi, '$1=***');
}
