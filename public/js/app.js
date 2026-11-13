// Démarrage de l'application : routeur, mise en page, actions globales.
import { html } from './html.js';
import { api } from './api.js';
import { state, setUser, onChange, prefs } from './store.js';
import { icon, toast, openSheet, closeSheet, rateRow, fmtScore, plural, placeholder, epCode } from './ui.js';
import { activateAds } from './ads.js';

import home from './pages/home.js';
import browse from './pages/browse.js';
import titlePage from './pages/title.js';
import episodePage from './pages/episode.js';
import searchPage from './pages/search.js';
import forYou from './pages/foryou.js';
import profile from './pages/profile.js';
import premium from './pages/premium.js';
import { login, register } from './pages/auth.js';
import admin from './pages/admin.js';
import about from './pages/about.js';

const routes = [
  ['/', home, 'home'],
  ['/films', (ctx) => browse(ctx, 'movie'), 'films'],
  ['/series', (ctx) => browse(ctx, 'series'), 'series'],
  ['/pour-vous', forYou, 'foryou'],
  ['/recherche', searchPage, null],
  ['/titre/:id', titlePage, null],
  ['/titre/:id/saison/:season', titlePage, null],
  ['/episode/:id', episodePage, null],
  ['/profil', profile, 'profile'],
  ['/premium', premium, null],
  ['/connexion', login, 'profile'],
  ['/inscription', register, 'profile'],
  ['/admin', admin, null],
  ['/a-propos', about, null],
];

const view = document.getElementById('view');
let navId = 0;
let pageActions = {};
const scrollPositions = new Map();

function match(path) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  for (const [pattern, page, nav] of routes) {
    const pp = pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) {
      return { page, params, nav };
    }
  }
  return null;
}

export function navigate(url, { replace = false } = {}) {
  scrollPositions.set(location.pathname + location.search, window.scrollY);
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
  route({ restoreScroll: false });
}

async function route({ restoreScroll = true } = {}) {
  const id = ++navId;
  closeSheet();
  pageActions = {};
  const url = new URL(location.href);
  const found = match(url.pathname);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', found?.nav === a.dataset.nav));

  const ctx = {
    params: found?.params || {},
    query: Object.fromEntries(url.searchParams),
    path: url.pathname,
    isCurrent: () => id === navId,
    setTitle: (t) => {
      document.title = t ? `${t} · ${state.config.appName}` : `${state.config.appName} — Notez films, séries et épisodes`;
    },
    render(content) {
      if (id !== navId) return;
      view.innerHTML = String(content);
      activateAds(view);
    },
    actions: pageActions,
  };

  if (!found) {
    ctx.setTitle('Page introuvable');
    ctx.render(html`<div class="empty"><h1>Page introuvable</h1><p>Cette page n’existe pas ou a été déplacée.</p>
      <a class="btn" href="/">Retour à l’accueil</a></div>`);
    return;
  }

  try {
    await found.page(ctx);
  } catch (err) {
    if (id !== navId) return;
    console.error(err);
    ctx.render(html`<div class="empty"><h1>Oups…</h1><p>${err.message || 'Une erreur est survenue.'}</p>
      <button class="btn" data-action="reload">${icon('refresh', 16)} Réessayer</button></div>`);
  }
  if (id !== navId) return;
  const key = url.pathname + url.search;
  window.scrollTo(0, restoreScroll ? scrollPositions.get(key) || 0 : 0);
}

/** Rafraîchit la page courante (après connexion, abonnement…). */
export function refresh() {
  route({ restoreScroll: true });
}

export function goLogin(message) {
  if (message) toast(message);
  navigate(`/connexion?retour=${encodeURIComponent(location.pathname + location.search)}`);
}

// ---------- Mise en page ----------
function renderAccount() {
  const el = document.getElementById('account');
  const u = state.user;
  el.innerHTML = String(
    u
      ? html`${u.isPremium
            ? html`<span class="premium-badge" title="Membre Premium">${icon('crown', 14)} Premium</span>`
            : html`<a class="btn btn-sm btn-premium hide-sm" href="/premium">${icon('crown', 14)} Premium</a>`}
          ${u.isAdmin ? html`<a class="icon-btn hide-sm" href="/admin" aria-label="Administration">${icon('shield')}</a>` : ''}
          <a class="avatar" href="/profil" aria-label="Mon profil" title="${u.username}">${u.username.slice(0, 1).toUpperCase()}</a>`
      : html`<a class="btn btn-sm" href="/connexion">Connexion</a>`,
  );
}

function applyTheme() {
  const t = prefs.get('theme', 'auto');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- Notes (actions globales) ----------
function updateRating(target, id, myScore, community) {
  document.querySelectorAll(`[data-rate-row="${target}-${id}"]`).forEach((row) => {
    row.querySelectorAll('.rate-btn').forEach((b) => {
      const n = Number(b.dataset.score);
      b.classList.toggle('on', myScore != null && n <= myScore);
      b.classList.toggle('current', n === myScore);
      b.setAttribute('aria-pressed', String(n === myScore));
    });
  });
  document.querySelectorAll(`[data-unrate="${target}-${id}"]`).forEach((b) => (b.hidden = myScore == null));
  document.querySelectorAll(`[data-community="${target}-${id}"]`).forEach((el) => {
    el.textContent = community?.count ? `${fmtScore(community.score)} · ${plural(community.count, 'note', 'notes')}` : 'Aucune note';
  });
  if (target === 'episode') {
    document.querySelectorAll(`[data-my-ep="${id}"]`).forEach((el) => {
      el.classList.toggle('rated', myScore != null);
      el.innerHTML = String(myScore != null ? html`${icon('star', 13)} ${myScore}` : html`${icon('star', 13)} Noter`);
    });
  }
  document.dispatchEvent(new CustomEvent('rated', { detail: { target, id: Number(id), myScore, community } }));
}

const globalActions = {
  reload: () => refresh(),
  'close-sheet': () => closeSheet(),
  async rate(el) {
    if (!state.user) return goLogin('Connectez-vous pour noter.');
    const { target, id, score } = el.dataset;
    try {
      const res = await api.put(`/${target === 'title' ? 'titles' : 'episodes'}/${id}/rating`, { score: Number(score) });
      updateRating(target, id, res.myScore, res.community);
      toast(`Note enregistrée : ${score}/10`, 'success');
      if (el.closest('.sheet')) setTimeout(closeSheet, 350);
    } catch (err) {
      toast(err.message, 'error');
    }
  },
  async unrate(el) {
    const { target, id } = el.dataset;
    try {
      const res = await api.del(`/${target === 'title' ? 'titles' : 'episodes'}/${id}/rating`);
      updateRating(target, id, null, res.community);
      toast('Note retirée');
      if (el.closest('.sheet')) setTimeout(closeSheet, 250);
    } catch (err) {
      toast(err.message, 'error');
    }
  },
  'rate-episode'(el) {
    if (!state.user) return goLogin('Connectez-vous pour noter les épisodes.');
    const { id, name, season, number } = el.dataset;
    const score = el.dataset.score ? Number(el.dataset.score) : null;
    openSheet(
      html`<p class="eyebrow">${epCode(season, number)}</p>
        <h2 class="sheet-title">${name}</h2>
        <p class="muted">Votre note sur 10</p>
        ${rateRow({ target: 'episode', id, score })}
        <div class="sheet-actions">
          <button class="btn btn-ghost" data-action="unrate" data-target="episode" data-id="${id}" data-unrate="episode-${id}" ${score == null ? 'hidden' : ''}>
            ${icon('trash', 16)} Retirer ma note</button>
          <a class="btn btn-ghost" href="/episode/${id}">Fiche de l’épisode ${icon('next', 16)}</a>
        </div>`,
      { label: `Noter ${name}` },
    );
  },
  async logout() {
    await api.post('/auth/logout').catch(() => {});
    navigator.serviceWorker?.controller?.postMessage('clear-api');
    setUser(null);
    toast('Vous êtes déconnecté.');
    navigate('/');
  },
  async install() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null;
    refresh();
  },
  theme(el) {
    prefs.set('theme', el.dataset.value === 'auto' ? null : el.dataset.value);
    applyTheme();
    document.querySelectorAll('[data-action="theme"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  },
};

// ---------- Installation (PWA) ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
});
export const canInstall = () => Boolean(deferredInstall);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ---------- Écouteurs globaux ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) {
    const fn = pageActions[el.dataset.action] || globalActions[el.dataset.action];
    if (fn) {
      e.preventDefault();
      fn(el, e);
      return;
    }
  }
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const name = form.dataset.form;
  if (name === 'search') {
    const q = new FormData(form).get('q')?.toString().trim();
    if (q) navigate(`/recherche?q=${encodeURIComponent(q)}`);
    return;
  }
  const fn = pageActions[`submit:${name}`];
  if (fn) fn(form, Object.fromEntries(new FormData(form)));
});

// Affiche une vignette de remplacement si une affiche ne se charge pas.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img?.tagName === 'IMG' && img.dataset.ph !== undefined) {
      img.outerHTML = String(placeholder(img.dataset.ph));
    }
  },
  true,
);

window.addEventListener('popstate', () => route());

// ---------- Démarrage ----------
async function boot() {
  applyTheme();
  document.getElementById('year').textContent = new Date().getFullYear();
  const [config, me] = await Promise.allSettled([api.get('/config'), api.get('/me')]);
  if (config.status === 'fulfilled') state.config = config.value;
  if (me.status === 'fulfilled') state.user = me.value.user;
  document.querySelectorAll('.brand-name').forEach((el) => (el.textContent = state.config.appName));
  renderAccount();
  onChange(renderAccount);
  await route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
