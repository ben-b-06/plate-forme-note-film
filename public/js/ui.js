// Composants d'interface réutilisables.
import { html, raw } from './html.js';

// ---------- Icônes (SVG inline, traits 2px) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  tv: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="m8 2 4 4 4-4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  crown: '<path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5z"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 14v6H4V5h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/>',
  ad: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l2-6 2 6M7.7 13h2.6M14 9v6h1.5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z"/>',
};

export function icon(name, size = 20) {
  return raw(
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`,
  );
}

// ---------- Formats ----------
export const fmtScore = (n) => (n == null ? '–' : Number(n).toFixed(1).replace('.', ','));

export function fmtDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  const date = typeof d === 'number' ? new Date(d) : new Date(`${d}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR', opts);
}

export function fmtDateTime(ms) {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export const fmtCount = (n) => (n == null ? '' : new Intl.NumberFormat('fr-FR', { notation: n >= 10000 ? 'compact' : 'standard' }).format(n));

export function plural(n, one, many) {
  return `${fmtCount(n)} ${n > 1 ? many : one}`;
}

export const epCode = (s, e) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;

export function years(t) {
  if (!t.year) return '';
  if (t.type !== 'series') return String(t.year);
  if (t.endYear && t.endYear !== t.year) return `${t.year}–${t.endYear}`;
  return t.endYear ? String(t.year) : `${t.year}–`;
}

// ---------- Notes ----------
export function scoreClass(n) {
  if (n == null) return 's-none';
  if (n >= 7.5) return 's-good';
  if (n >= 5.5) return 's-mid';
  return 's-low';
}

export function scoreBadge(n, { title, small = false } = {}) {
  if (n == null) return '';
  return html`<span class="score ${scoreClass(n)} ${small ? 'score-sm' : ''}" title="${title || ''}">${fmtScore(n)}</span>`;
}

export const SOURCES = {
  imdb: { label: 'IMDb', scale: '/10' },
  rotten_tomatoes: { label: 'Rotten Tomatoes', scale: '%' },
  metacritic: { label: 'Metacritic', scale: '/100' },
  tmdb: { label: 'TMDB', scale: '/10' },
  tvmaze: { label: 'TVmaze', scale: '/10' },
};

/** Ligne de 10 boutons pour noter (1 à 10). */
export function rateRow({ target, id, score }) {
  return html`<div class="rate-row" role="group" aria-label="Votre note sur 10" data-rate-row="${target}-${id}">
    ${Array.from({ length: 10 }, (_, i) => {
      const n = i + 1;
      return html`<button type="button" class="rate-btn ${score && n <= score ? 'on' : ''} ${n === score ? 'current' : ''}"
        data-action="rate" data-target="${target}" data-id="${id}" data-score="${n}" aria-pressed="${n === score}"
        aria-label="${n} sur 10">${n}</button>`;
    })}
  </div>`;
}

// ---------- Affiches & cartes ----------
function hue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function poster(item, { large = false } = {}) {
  const src = item.poster;
  if (src) {
    return html`<img src="${src}" alt="" loading="${large ? 'eager' : 'lazy'}" decoding="async" data-ph="${item.title || ''}" />`;
  }
  return placeholder(item.title || '');
}

export function placeholder(title) {
  return html`<div class="poster-ph" style="--h:${hue(title)}" aria-hidden="true"><span>${title}</span></div>`;
}

export function card(item, { reason = true, showType = true } = {}) {
  const genre = item.genres?.slice(0, 2).join(', ');
  return html`<a class="card" href="/titre/${item.id}">
    <div class="poster">
      ${poster(item)}
      <div class="poster-badges">
        ${item.extScore != null ? scoreBadge(item.extScore, { title: 'Moyenne des plateformes', small: true }) : ''}
        ${item.myScore != null ? html`<span class="mine" title="Votre note">${icon('star', 12)} ${item.myScore}</span>` : ''}
      </div>
    </div>
    <div class="card-body">
      <div class="card-title">${item.title}</div>
      <div class="card-meta">${[showType && (item.type === 'series' ? 'Série' : 'Film'), years(item), genre].filter(Boolean).join(' · ')}</div>
      ${item.communityCount
        ? html`<div class="card-meta">${icon('user', 12)} ${fmtScore(item.communityScore)} · ${plural(item.communityCount, 'note', 'notes')}</div>`
        : ''}
      ${reason && item.reason ? html`<div class="card-reason">${item.reason.text}</div>` : ''}
    </div>
  </a>`;
}

export function rail(title, items, { href, empty, render = card, subtitle } = {}) {
  if (!items?.length && !empty) return '';
  return html`<section class="section">
    <div class="section-head">
      <div>
        <h2>${title}</h2>
        ${subtitle ? html`<p class="section-sub">${subtitle}</p>` : ''}
      </div>
      ${href ? html`<a class="link-more" href="${href}">Tout voir ${icon('next', 16)}</a>` : ''}
    </div>
    ${items?.length ? html`<div class="rail">${items.map((i) => render(i))}</div>` : html`<p class="muted">${empty}</p>`}
  </section>`;
}

export function grid(items, opts) {
  return html`<div class="grid">${items.map((i) => card(i, opts))}</div>`;
}

export function episodeCard({ series, episode }, { cta = 'Noter' } = {}) {
  return html`<a class="ep-card" href="/episode/${episode.id}">
    <div class="ep-card-poster">${poster(series)}</div>
    <div class="ep-card-body">
      <div class="card-title">${series.title}</div>
      <div class="card-meta">${epCode(episode.season, episode.number)}${episode.airDate ? ` · ${fmtDate(episode.airDate, { day: 'numeric', month: 'short' })}` : ''}</div>
      <div class="ep-card-name">${episode.name || `Épisode ${episode.number}`}</div>
      <span class="chip chip-accent">${icon('star', 12)} ${cta}</span>
    </div>
  </a>`;
}

export function skeletonRail(n = 6) {
  return html`<section class="section"><div class="section-head"><div class="sk sk-title"></div></div>
    <div class="rail">${Array.from({ length: n }, () => html`<div class="card"><div class="poster sk"></div><div class="sk sk-line"></div></div>`)}</div></section>`;
}

export function emptyState({ title, text, action }) {
  return html`<div class="empty">
    <h2>${title}</h2>
    ${text ? html`<p>${text}</p>` : ''}
    ${action || ''}
  </div>`;
}

export function errorState(err) {
  return emptyState({
    title: 'Oups…',
    text: err?.message || 'Une erreur est survenue.',
    action: html`<button class="btn" data-action="reload">${icon('refresh', 16)} Réessayer</button>`,
  });
}

// ---------- Toasts ----------
export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}

// ---------- Feuille modale (bas d'écran sur mobile) ----------
let lastFocus = null;

export function openSheet(content, { label = 'Fenêtre' } = {}) {
  closeSheet();
  lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = String(html`<div class="sheet-backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1">
      <button class="icon-btn sheet-close" data-action="close-sheet" aria-label="Fermer">${icon('close')}</button>
      <div class="sheet-content">${content}</div>
    </div>`);
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    wrap.querySelector('.sheet').focus();
  });
  return wrap;
}

export function closeSheet() {
  const wrap = document.querySelector('.sheet-wrap');
  if (!wrap) return;
  wrap.remove();
  document.body.classList.remove('no-scroll');
  lastFocus?.focus?.();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});
