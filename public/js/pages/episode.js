import { html } from '../html.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { icon, fmtScore, fmtDate, plural, epCode } from '../ui.js';
import { adSlot } from '../ads.js';
import { commentsSection, mountComments } from '../comments.js';
import { platformRatings, myRatingBlock } from './title.js';

export default async function episodePage(ctx) {
  const id = Number(ctx.params.id);
  const e = await api.get(`/episodes/${id}`);
  const name = e.name || `Épisode ${e.number}`;
  ctx.setTitle(`${e.series.title} ${epCode(e.season, e.number)} – ${name}`);

  const nav = (n, dir) =>
    n
      ? html`<a class="ep-nav-link ep-nav-${dir}" href="/episode/${n.id}">
          ${dir === 'prev' ? icon('back', 16) : ''}
          <span><span class="muted small">${dir === 'prev' ? 'Précédent' : 'Suivant'} · ${epCode(n.season, n.number)}</span><br />${n.name || `Épisode ${n.number}`}</span>
          ${dir === 'next' ? icon('next', 16) : ''}
        </a>`
      : html`<span></span>`;

  ctx.render(html`
    <article class="episode-page">
      <a class="back-link" href="/titre/${e.series.id}/saison/${e.season}">${icon('back', 16)} ${e.series.title} · Saison ${e.season}</a>
      <header class="episode-head ${e.still ? 'has-still' : ''}">
        ${e.still ? html`<img class="episode-still" src="${e.still}" alt="" data-ph="${name}" />` : ''}
        <div>
          <p class="eyebrow">${epCode(e.season, e.number)}${e.airDate ? ` · ${fmtDate(e.airDate)}` : ''}${e.runtime ? ` · ${e.runtime} min` : ''}</p>
          <h1>${name}</h1>
          <p class="muted">${icon('user', 14)} Communauté : <span data-community="episode-${e.id}">${e.communityCount ? `${fmtScore(e.communityScore)} · ${plural(e.communityCount, 'note', 'notes')}` : 'Aucune note'}</span></p>
        </div>
      </header>

      ${myRatingBlock({ target: 'episode', id: e.id, score: e.myScore, label: 'Ma note pour cet épisode' })}

      ${e.overview ? html`<section class="section"><h2>Résumé</h2><p class="overview">${e.overview}</p></section>` : ''}

      <section class="section panel">
        <h2>Notes des plateformes</h2>
        ${platformRatings(e.externalRatings, { emptyText: 'Pas encore de note pour cet épisode sur les autres plateformes.' })}
      </section>

      <nav class="ep-nav" aria-label="Épisodes">${nav(e.prev, 'prev')}${nav(e.next, 'next')}</nav>

      ${adSlot('banner')}
      ${commentsSection({ titleId: e.series.id, episodeId: e.id })}
    </article>
  `);

  // Après avoir noté, proposer directement l'épisode suivant.
  const onRated = (ev) => {
    if (!ctx.isCurrent()) return document.removeEventListener('rated', onRated);
    if (ev.detail.target === 'episode' && ev.detail.id === e.id && ev.detail.myScore != null && e.next && state.user) {
      document.querySelector('.ep-nav-next')?.classList.add('pulse');
    }
  };
  document.addEventListener('rated', onRated);

  await mountComments(ctx, { titleId: e.series.id, episodeId: e.id });
}
