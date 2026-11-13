// Lance une synchronisation unique puis quitte : `npm run sync`
// Utile pour un cron système / une tâche planifiée de l'hébergeur.
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createProviders } from '../server/providers/index.js';
import { createSync } from '../server/sync/sync.js';
import { seedCatalog } from '../server/seed.js';

const config = loadConfig();
const db = openDb(config.dbPath);
seedCatalog(db);
const sync = createSync({ db, config, providers: createProviders(config) });
const result = await sync.run('cli');
console.log(JSON.stringify(result, null, 2));
db.close();
process.exit(result.status === 'erreur' ? 1 : 0);
