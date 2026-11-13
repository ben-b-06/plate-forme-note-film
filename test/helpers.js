import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedCatalog } from '../server/seed.js';

export const silent = { info() {}, warn() {}, error() {} };

/**
 * Faux `fetch` : `routes` = [[motif (string|RegExp), réponse JSON | (url) => JSON | { status }]].
 * Toute URL non prévue répond 404. Les URL appelées sont enregistrées dans `calls`.
 */
export function mockFetch(routes) {
  const calls = [];
  const fn = async (input) => {
    const url = String(input);
    calls.push(url);
    for (const [pattern, reply] of routes) {
      const hit = typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);
      if (!hit) continue;
      const body = typeof reply === 'function' ? reply(url) : reply;
      if (body && body.__status) return new Response(JSON.stringify(body.body ?? {}), { status: body.__status });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

export function testConfig(overrides = {}) {
  return loadConfig(
    {},
    {
      dbPath: ':memory:',
      authRateLimit: 1000,
      sync: { enabled: false },
      ...overrides,
    },
  );
}

/** Démarre l'application sur un port libre. */
export async function startApp({ config = testConfig(), fetchImpl = mockFetch([]), seed = true } = {}) {
  const db = openDb(':memory:');
  if (seed) seedCatalog(db);
  const ctx = createApp({ db, config, fetchImpl, log: silent });
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...ctx,
    db,
    base,
    config,
    client: () => createClient(base),
    close: () =>
      new Promise((resolve) => {
        ctx.sync.stop();
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

/** Petit client HTTP avec gestion du cookie de session. */
export function createClient(base) {
  let cookie = '';
  async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(method !== 'GET' ? { 'X-Requested-With': 'fetch' } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* vide */
    }
    return { status: res.status, data };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b = {}, h) => call('POST', p, b, h),
    put: (p, b = {}, h) => call('PUT', p, b, h),
    del: (p, b, h) => call('DELETE', p, b, h),
    async register(username = 'alice', email = `${username}@exemple.fr`) {
      return call('POST', '/api/auth/register', { username, email, password: 'motdepasse' });
    },
  };
}
