// Point d'entrée : `npm start`
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedCatalog } from './seed.js';

const config = loadConfig();
const db = openDb(config.dbPath);

const seeded = seedCatalog(db);
if (seeded) console.log(`[seed] catalogue de départ importé (${seeded} titres)`);

const { app, sync } = createApp({ db, config });

const server = app.listen(config.port, () => {
  const p = sync.status().providers;
  console.log(`${config.appName} démarré sur ${config.publicUrl} (port ${config.port})`);
  console.log(
    `[sync] sources : TVmaze ${p.tvmaze ? 'oui' : 'non'}, TMDB ${p.tmdb ? 'oui' : 'non (TMDB_API_KEY)'}, OMDb ${p.omdb ? 'oui' : 'non (OMDB_API_KEY)'} — toutes les ${config.sync.intervalHours} h`,
  );
  if (config.premium.allowDemo) console.log('[premium] mode démo actif (aucun paiement réel)');
  sync.start();
});

function shutdown() {
  sync.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
