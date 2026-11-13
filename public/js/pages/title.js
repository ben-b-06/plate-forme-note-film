import { html } from '../html.js';
import { api } from '../api.js';
import { state } from '../store.js';
import {
  icon,
  poster,
  rateRow,
  scoreBadge,
  fmtScore,
  fmtDate,
  fmtCount,
  plural,
  years,
  rail,
  SOURCES,
} from '../ui.js';
import { adSlot } from '../ads.js';
import { commentsSection, mountComments } from '../comments.js';
import { episodeChart } from '../chart.js';
import { navigate } from '../app.js';

const cssUrl = (u) => encodeURI(u).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');

export function platformRatings(list, { emptyText } = {}) {
  if (!list.length) {
    return html`<p class="muted small">${emptyText ||
      'Les notes des autres plateformes apparaîtront après la prochaine mise à jour automatique.'}</p>`;
  }
  return html`<ul class="platforms">
    ${list.map((r) => {
      const meta = SOURCES[r.source] || { label: r.source };
      const inner = html`<span class="platform-name">${meta.label}</span>
        <span class="platform-value">${r.display}</span>
        ${r.votes ? html`<span class="platform-votes">${fmtCount(r.votes)} votes</span>` : ''}`;
      return html`<li class="platform platform-${r.source}">
        ${r.url ? html`<a href="${r.url}" target="_blank" rel="noopener noreferrer">${inner}</a>` : html`<div>${inner}</div>`}
      </li>`;
    })}
  </ul>`;
}

export function myRatingBlock({ target, id, score, label }) {
  if (!state.user) {
    return html`<div class="rate-block">
      <h3>${label}</h3>
      <p class="muted">Connectez-vous pour noter et recevoir des suggestions personnalisées.</p>
      <a class="btn btn-primary btn-sm" href="/connexion">Se connecter</a>
    </div>`;
  }
  return html`<div class="rate-block">
    <div class="rate-head">
      <h3>${label}</h3>
      <button class="link-btn" data-action="unrate" data-target="${target}" data-id="${id}" data-unrate="${target}-${id}" ${score == null ? 'hidden' : ''}>Retirer</button>
    </div>
    ${rateRow({ target, id, score })}
  </div>`;
}

function episodeRow(e) {
  const ext = e.externalRatings;
  const extAvg = ext.length ? ext.reduce((s, r) => s + r.score, 0) / ext.length : null;
  const name = e.name || `Épisode ${e.number}`;
  return html`<li class="ep-row">
    <a class="ep-main" href="/episode/${e.id}">
      <span class="ep-num">${e.number}</span>
      <span class="ep-text">
        <span class="ep-name">${name}</span>
        <span class="ep-meta">${[e.airDate && fmtDate(e.airDate), e.runtime && `${e.runtime} min`].filter(Boolean).join(' · ')}</span>
      </span>
    </a>
    <span class="ep-scores">
      ${extAvg != null ? html`<span class="ep-score" title="${ext.map((r) => `${SOURCES[r.source]?.label}: ${r.display}`).join(' · ')}">${scoreBadge(extAvg, { small: true })}</span>` : ''}
      <span class="ep-community muted" data-community="episode-${e.id}" title="Communauté">${e.communityCount ? `${fmtScore(e.communityScore)} · ${plural(e.communityCount, 'note', 'notes')}` : ''}</span>
    </span>
    <button class="my-ep ${e.myScore != null ? 'rated' : ''}" data-my-ep="${e.id}" data-action="rate-episode" data-id="${e.id}"
      data-name="${name}" data-season="${e.season}" data-number="${e.number}" data-score="${e.myScore ?? ''}"
      aria-label="Noter l’épisode ${e.number}">
      ${icon('star', 13)} ${e.myScore != null ? e.myScore : 'Noter'}
    </button>
  </li>`;
}

export default async function titlePage(ctx) {
  const id = Number(ctx.params.id);
  ctx.render(html`<div class="title-skeleton"><div class="sk sk-hero"></div></div>`);
  const t = await api.get(`/titles/${id}`);
  ctx.setTitle(t.title);
  const isSeries = t.type === 'series';
  const seasonNumber = isSeries
    ? Number(ctx.params.season) || t.seasons.find((s) => s.episodeCount > 0)?.number || t.seasons[0]?.number || null
    : null;
  const season = seasonNumber ? await api.get(`/titles/${id}/seasons/${seasonNumber}`) : null;
  if (!ctx.isCurrent()) return;

  const details = [
    [isSeries ? 'Diffusion' : 'Sortie', t.releaseDate ? fmtDate(t.releaseDate) : t.year],
    ['Statut', t.status],
    ['Chaîne / plateforme', t.network],
    ['Durée', t.runtime && `${t.runtime} min${isSeries ? ' / épisode' : ''}`],
    ['Titre original', t.originalTitle],
  ].filter(([, v]) => v);

  ctx.render(html`
    <article class="title-page">
      <header class="title-hero" ${t.backdrop ? html`style="--backdrop:url('${cssUrl(t.backdrop)}')"` : ''}>
        <div class="title-hero-inner">
          <div class="title-poster">${poster(t, { large: true })}</div>
          <div class="title-info">
            <p class="eyebrow">${isSeries ? 'Série' : 'Film'}</p>
            <h1>${t.title}</h1>
            <p class="title-meta">${[years(t), t.runtime && !isSeries && `${t.runtime} min`, isSeries && t.seasons.length && plural(t.seasons.length, 'saison', 'saisons')].filter(Boolean).join(' · ')}</p>
            <div class="chips">${t.genres.map((g) => html`<a class="chip" href="/${isSeries ? 'series' : 'films'}?genre=${encodeURIComponent(g)}">${g}</a>`)}</div>
            <div class="scores-row">
              ${t.externalScore != null
                ? html`<div class="big-score"><span class="score score-lg ${t.externalScore >= 7.5 ? 's-good' : t.externalScore >= 5.5 ? 's-mid' : 's-low'}">${fmtScore(t.externalScore)}</span>
                    <span>Moyenne des plateformes</span></div>`
                : ''}
              <div class="big-score">
                <span class="score score-lg score-community">${icon('user', 16)}</span>
                <span><span data-community="title-${t.id}">${t.community.count ? `${fmtScore(t.community.score)} · ${plural(t.community.count, 'note', 'notes')}` : 'Aucune note'}</span><br />Communauté ${state.config.appName}</span>
              </div>
              ${isSeries && t.episodesCommunity.count
                ? html`<div class="big-score"><span class="score score-lg score-community">${icon('tv', 16)}</span>
                    <span>${fmtScore(t.episodesCommunity.score)} · ${plural(t.episodesCommunity.count, 'note', 'notes')}<br />Moyenne des épisodes</span></div>`
                : ''}
            </div>
          </div>
        </div>
      </header>

      <div class="title-layout">
        <div class="title-main">
          ${myRatingBlock({ target: 'title', id: t.id, score: t.myScore, label: isSeries ? 'Ma note pour la série' : 'Ma note' })}
          ${isSeries && t.myEpisodes?.count
            ? html`<p class="muted small">Vous avez noté ${plural(t.myEpisodes.count, 'épisode', 'épisodes')} · moyenne ${fmtScore(t.myEpisodes.score)}/10</p>`
            : ''}

          ${t.overview ? html`<section class="section"><h2>Synopsis</h2><p class="overview">${t.overview}</p></section>` : ''}

          ${isSeries ? seasonsSection(t, season) : ''}

          ${adSlot('banner')}

          ${commentsSection({ titleId: t.id })}
        </div>

        <aside class="title-side">
          <section class="panel">
            <h2>Notes des plateformes</h2>
            ${platformRatings(t.externalRatings)}
          </section>
          ${details.length
            ? html`<section class="panel"><h2>Informations</h2>
                <dl class="details">${details.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
                ${t.links.length
                  ? html`<div class="ext-links">${t.links.map((l) => html`<a href="${l.url}" target="_blank" rel="noopener noreferrer">${SOURCES[l.source]?.label || l.source} ${icon('external', 13)}</a>`)}</div>`
                  : ''}
              </section>`
            : ''}
          ${adSlot('infeed')}
        </aside>
      </div>

      ${rail('Titres similaires', t.similar)}
    </article>
  `);

  ctx.actions.season = (btn) => navigate(`/titre/${t.id}/saison/${btn.dataset.season}`, { replace: true });

  // Met à jour le compteur « x/y notés » quand on note un épisode depuis la liste.
  const onRated = (ev) => {
    if (!ctx.isCurrent()) return document.removeEventListener('rated', onRated);
    if (ev.detail.target !== 'episode') return;
    const counter = document.querySelector('[data-rated-count]');
    const buttons = document.querySelectorAll('.ep-list .my-ep');
    if (counter) counter.textContent = `${document.querySelectorAll('.ep-list .my-ep.rated').length}/${buttons.length} notés`;
  };
  document.addEventListener('rated', onRated);
  await mountComments(ctx, { titleId: t.id });
}

function seasonsSection(t, season) {
  if (!t.seasons.length) {
    return html`<section class="section"><h2>Épisodes</h2>
      <p class="muted">La liste des épisodes sera ajoutée lors de la prochaine mise à jour automatique du catalogue.</p></section>`;
  }
  const rated = season?.episodes.filter((e) => e.myScore != null).length || 0;
  return html`<section class="section" id="episodes">
    <div class="section-head"><h2>Épisodes</h2>
      ${state.user && season?.episodes.length ? html`<span class="muted small" data-rated-count>${rated}/${season.episodes.length} notés</span>` : ''}</div>
    <div class="chips-scroll season-tabs" role="tablist" aria-label="Saisons">
      ${t.seasons.map(
        (s) => html`<button role="tab" class="chip ${s.number === season?.number ? 'active' : ''}" aria-selected="${s.number === season?.number}"
          data-action="season" data-season="${s.number}">Saison ${s.number}${s.myRatedCount ? html` <span class="dot" aria-label="notée"></span>` : ''}</button>`,
      )}
    </div>
    ${season
      ? html`${season.overview ? html`<p class="muted">${season.overview}</p>` : ''}
          ${episodeChart(season.episodes)}
          ${season.episodes.length
            ? html`<ol class="ep-list">${season.episodes.map(episodeRow)}</ol>`
            : html`<p class="muted">Aucun épisode pour cette saison.</p>`}`
      : ''}
  </section>`;
}

