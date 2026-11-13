import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createAuth } from './auth.js';
import { createApiRouter } from './routes/api.js';
import { createBilling } from './services/billing.js';
import { createSync } from './sync/sync.js';
import { createProviders } from './providers/index.js';
import { HttpError } from './util.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function contentSecurityPolicy(config) {
  const ads = Boolean(config.ads.adsenseClient);
  // Les régies publicitaires (AdSense) chargent des scripts et iframes depuis de nombreux domaines.
  const script = ads ? "'self' 'unsafe-inline' https:" : "'self'";
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    `connect-src 'self'${ads ? ' https:' : ''}`,
    `frame-src ${ads ? 'https:' : "'none'"}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
  ].join('; ');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Crée l'application Express. Les dépendances sont injectables pour les tests.
 */
export function createApp({ db, config, fetchImpl, log = console, providers, sync, billing } = {}) {
  providers ||= createProviders(config, { fetchImpl });
  sync ||= createSync({ db, config, providers, log });
  billing ||= createBilling({ db, config, fetchImpl, log });
  const auth = createAuth({ db, config });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  const csp = contentSecurityPolicy(config);
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Webhook Stripe : corps brut nécessaire pour vérifier la signature.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const event = billing.verifySignature(req.body.toString('utf8'), req.headers['stripe-signature']);
    await billing.handleEvent(event);
    res.json({ received: true });
  });

  // Déclenchement externe de la synchronisation (cron d'hébergeur, cron-job.org…).
  app.all('/api/cron/sync', (req, res) => {
    if (!config.sync.secret) throw new HttpError(404, 'Introuvable.');
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (!token || !safeEqual(token, config.sync.secret)) throw new HttpError(401, 'Jeton invalide.');
    if (sync.status().running) return res.status(202).json({ started: false, running: true });
    sync.run('cron').catch(() => {});
    res.status(202).json({ started: true });
  });

  app.use('/api', express.json({ limit: '100kb' }));

  // Protection CSRF : toute écriture doit venir de notre propre front (en-tête personnalisé,
  // impossible à envoyer depuis un autre site sans autorisation CORS).
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'fetch') return next(new HttpError(403, 'Requête refusée.'));
    next();
  });

  app.use('/api', auth.loadUser);
  app.use('/api', createApiRouter({ db, config, auth, sync, billing }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ressource introuvable.')));

  if (config.ads.adsenseClient) {
    app.get('/ads.txt', (_req, res) => {
      const pub = config.ads.adsenseClient.replace(/^ca-/, '');
      res.type('text/plain').send(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
    });
  }

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      setHeaders(res, path) {
        if (path.includes(`${join('public', 'icons')}`)) res.setHeader('Cache-Control', 'public, max-age=604800');
        else res.setHeader('Cache-Control', 'no-cache');
        if (path.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
      },
    }),
  );

  // Application monopage : toutes les autres URL renvoient index.html.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error?.(`[erreur] ${req.method} ${req.originalUrl} :`, err);
    const message =
      status >= 500
        ? 'Erreur interne, réessayez plus tard.'
        : err.type === 'entity.parse.failed'
          ? 'Données invalides.'
          : err.message;
    res.status(status).json({ error: message, code: status < 500 && typeof err.code === 'string' && !err.code.startsWith('E') ? err.code : undefined });
  });

  return { app, sync, billing, providers, auth };
}
