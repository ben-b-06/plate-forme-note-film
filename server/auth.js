// Comptes, mots de passe (scrypt) et sessions (cookie httpOnly).
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, now, DAY } from './util.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'cn_session';
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, n, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    ...SCRYPT,
    N: Number(n),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function createAuth({ db, config }) {
  const maxAgeMs = config.sessionDays * DAY;

  function cookieHeader(value, maxAgeSec) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (config.isProd || config.publicUrl.startsWith('https://')) parts.push('Secure');
    return parts.join('; ');
  }

  function startSession(res, userId) {
    const token = randomBytes(32).toString('base64url');
    const t = now();
    db.run(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      sha256(token),
      userId,
      t + maxAgeMs,
      t,
    );
    // Nettoyage opportuniste des sessions expirées.
    db.run('DELETE FROM sessions WHERE expires_at < ?', t);
    res.setHeader('Set-Cookie', cookieHeader(token, Math.floor(maxAgeMs / 1000)));
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    res.setHeader('Set-Cookie', cookieHeader('', 0));
  }

  function decorate(user) {
    if (!user) return null;
    const isPremium = Boolean(user.premium_until && user.premium_until > now());
    return {
      ...user,
      isPremium,
      isAdmin: config.adminEmails.includes(String(user.email).toLowerCase()),
    };
  }

  /** Middleware : charge req.user depuis le cookie de session. */
  function loadUser(req, _res, next) {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const row = db.get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
        sha256(token),
        now(),
      );
      req.user = decorate(row);
    }
    next();
  }

  function getUser(id) {
    return decorate(db.get('SELECT * FROM users WHERE id = ?', id));
  }

  return { startSession, endSession, loadUser, getUser, decorate };
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    isPremium: u.isPremium,
    isAdmin: u.isAdmin,
    premiumUntil: u.premium_until || null,
    premiumProvider: u.premium_provider || null,
    subscriptionStatus: u.subscription_status || null,
    createdAt: u.created_at,
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Connectez-vous pour continuer.'));
  next();
}

export function requirePremium(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Connectez-vous pour continuer.'));
  if (!req.user.isPremium) {
    return next(new HttpError(403, 'Cette fonctionnalité est réservée aux membres Premium.', { code: 'premium_required' }));
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user?.isAdmin) return next(new HttpError(403, 'Accès réservé aux administrateurs.'));
  next();
}

/** Limiteur de débit très simple, en mémoire, par IP et par clé. */
export function rateLimit({ windowMs, max, key = 'default' }) {
  const hits = new Map();
  return (req, _res, next) => {
    const id = `${key}:${req.ip}`;
    const t = now();
    const entry = hits.get(id);
    if (!entry || entry.reset < t) {
      hits.set(id, { count: 1, reset: t + windowMs });
    } else if (++entry.count > max) {
      return next(new HttpError(429, 'Trop de tentatives, réessayez dans un instant.'));
    }
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    }
    next();
  };
}
