// Catalogue de départ (utilisé si la base est vide) + données de démonstration optionnelles.
import { readFileSync } from 'node:fs';
import { saveBundle } from './services/catalog.js';
import { hashPassword } from './auth.js';
import { now, DAY } from './util.js';

const SEED_FILE = new URL('./data/seed.json', import.meta.url);

export function seedCatalog(db, { force = false } = {}) {
  const count = db.get('SELECT COUNT(*) AS n FROM titles').n;
  if (count > 0 && !force) return 0;
  const { titles } = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  let n = 0;
  db.tx(() => {
    for (const t of titles) {
      const { seasons = [], ...title } = t;
      const episodes = seasons.flatMap((s) =>
        s.episodes.map((name, i) => ({ season_number: s.season_number, episode_number: i + 1, name })),
      );
      saveBundle(
        db,
        {
          title,
          seasons: seasons.map((s) => ({
            season_number: s.season_number,
            name: `Saison ${s.season_number}`,
            episode_count: s.episodes.length,
          })),
          episodes,
        },
        { source: 'seed' },
      );
      n++;
    }
  });
  db.setMeta('seeded_at', now());
  return n;
}

// Petit générateur pseudo-aléatoire déterministe (reproductible).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Crée des comptes « demo_* » avec des notes, pour tester l'app en local
 * (communauté, recommandations collaboratives). À NE PAS utiliser en production.
 */
export async function seedDemoCommunity(db) {
  const profiles = [
    { name: 'demo_alice', likes: ['Science-fiction', 'Thriller', 'Mystère'] },
    { name: 'demo_bruno', likes: ['Crime', 'Drame', 'Histoire'] },
    { name: 'demo_chloe', likes: ['Comédie', 'Romance', 'Animation'] },
    { name: 'demo_david', likes: ['Action', 'Aventure', 'Fantastique'] },
    { name: 'demo_emma', likes: ['Drame', 'Science-fiction', 'Animation'] },
    { name: 'demo_farid', likes: ['Crime', 'Thriller', 'Action'] },
  ];
  const titles = db.all('SELECT id, type, genres FROM titles');
  const password = await hashPassword('demo-demo-demo');
  const rand = rng(42);
  const t = now();
  let ratings = 0;
  db.tx(() => {
    for (const p of profiles) {
      const exists = db.get('SELECT id FROM users WHERE username = ?', p.name);
      const userId =
        exists?.id ??
        db.run(
          'INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
          `${p.name}@example.invalid`,
          p.name,
          password,
          t - 30 * DAY,
        ).lastInsertRowid;
      for (const title of titles) {
        if (rand() > 0.55) continue;
        const genres = JSON.parse(title.genres);
        const affinity = genres.filter((g) => p.likes.includes(g)).length;
        const score = Math.max(1, Math.min(10, Math.round(4.5 + affinity * 1.6 + (rand() - 0.5) * 3)));
        db.run(
          `INSERT OR IGNORE INTO title_ratings (user_id, title_id, score, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          userId,
          title.id,
          score,
          t,
          t,
        );
        ratings++;
        if (title.type === 'series') {
          for (const e of db.all('SELECT id FROM episodes WHERE title_id = ?', title.id)) {
            if (rand() > 0.7) continue;
            const es = Math.max(1, Math.min(10, score + Math.round((rand() - 0.5) * 4)));
            db.run(
              `INSERT OR IGNORE INTO episode_ratings (user_id, episode_id, title_id, score, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
              userId,
              e.id,
              title.id,
              es,
              t,
              t,
            );
            ratings++;
          }
        }
      }
    }
  });
  return { users: profiles.length, ratings };
}
