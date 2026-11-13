// Configuration centralisée, lue depuis les variables d'environnement.
// Voir .env.example pour la liste complète.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value != null ? n : fallback;
}

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).toLowerCase());
}

function list(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env = process.env, overrides = {}) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const port = num(env.PORT, 3000);

  const stripe = {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    priceId: env.STRIPE_PRICE_ID || '',
  };
  const stripeEnabled = Boolean(stripe.secretKey && stripe.priceId);

  const config = {
    appName: env.APP_NAME || 'CinéNote',
    nodeEnv,
    isProd,
    port,
    publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dbPath: env.DATABASE_PATH || 'data/app.db',
    sessionDays: num(env.SESSION_DAYS, 30),
    adminEmails: list(env.ADMIN_EMAILS),
    trustProxy: bool(env.TRUST_PROXY, isProd),
    // Nombre max. de tentatives de connexion / inscription par minute et par IP.
    authRateLimit: num(env.AUTH_RATE_LIMIT, 20),

    providers: {
      tmdbKey: env.TMDB_API_KEY || '',
      omdbKey: env.OMDB_API_KEY || '',
      tvmazeEnabled: bool(env.TVMAZE_ENABLED, true),
      language: env.TMDB_LANGUAGE || 'fr-FR',
      region: env.TMDB_REGION || 'FR',
    },

    sync: {
      enabled: bool(env.SYNC_ENABLED, true),
      intervalHours: num(env.SYNC_INTERVAL_HOURS, 6),
      onStart: bool(env.SYNC_ON_START, true),
      startDelaySeconds: num(env.SYNC_START_DELAY_SECONDS, 10),
      secret: env.SYNC_SECRET || '',
      tmdbPages: num(env.SYNC_TMDB_PAGES, 2),
      maxDetailsPerRun: num(env.SYNC_MAX_DETAILS, 40),
      tvmazeMaxPerRun: num(env.SYNC_TVMAZE_MAX, 40),
      tvmazeDiscoverPerRun: num(env.SYNC_TVMAZE_DISCOVER, 15),
      tvmazeCountries: list(env.SYNC_TVMAZE_COUNTRIES || 'FR,US').map((c) => c.toUpperCase()),
      omdbMaxPerRun: num(env.SYNC_OMDB_MAX, 60),
      staleDays: num(env.SYNC_STALE_DAYS, 3),
      maxSeasonsPerSeries: num(env.SYNC_MAX_SEASONS, 12),
    },

    ads: {
      adsenseClient: env.ADSENSE_CLIENT || '',
      slotBanner: env.ADSENSE_SLOT_BANNER || '',
      slotInfeed: env.ADSENSE_SLOT_INFEED || '',
    },

    stripe,
    premium: {
      priceLabel: env.PREMIUM_PRICE_LABEL || '2,99 € / mois',
      stripeEnabled,
      // Mode démo : active Premium sans paiement. Autorisé uniquement si Stripe
      // n'est pas configuré, et jamais en production sauf demande explicite.
      allowDemo: !stripeEnabled && (bool(env.ALLOW_DEMO_PREMIUM, !isProd)),
      demoDays: num(env.DEMO_PREMIUM_DAYS, 30),
    },
  };

  return deepMerge(config, overrides);
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object') {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}
