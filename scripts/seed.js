// `npm run seed` : importe le catalogue de départ si la base est vide.
// `npm run seed -- --demo` : ajoute aussi des comptes demo_* avec des notes (tests locaux uniquement).
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { seedCatalog, seedDemoCommunity } from '../server/seed.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const n = seedCatalog(db);
console.log(n ? `Catalogue importé : ${n} titres.` : 'Catalogue déjà présent, rien à importer.');
if (process.argv.includes('--demo')) {
  if (config.isProd) {
    console.error('Refusé : les données de démonstration ne doivent pas être ajoutées en production.');
    process.exit(1);
  }
  const r = await seedDemoCommunity(db);
  console.log(`Communauté de démo : ${r.users} comptes, ${r.ratings} notes (mot de passe : demo-demo-demo).`);
}
db.close();
