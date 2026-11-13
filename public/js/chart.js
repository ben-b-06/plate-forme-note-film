// Histogramme des notes par épisode (une seule série → pas de légende, le titre la nomme).
// Les valeurs exactes restent lisibles dans la liste d'épisodes juste en dessous (vue tableau).
import { html } from './html.js';
import { fmtScore } from './ui.js';

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function episodeChart(episodes) {
  if (!episodes?.length) return '';
  const community = episodes.filter((e) => e.communityCount > 0).length;
  const external = episodes.filter((e) => e.externalRatings.length > 0).length;
  if (!community && !external) return '';
  const useCommunity = community >= external;
  const values = episodes.map((e) =>
    useCommunity ? e.communityScore : avg(e.externalRatings.map((r) => r.score)),
  );
  const title = useCommunity ? 'Note moyenne de la communauté, par épisode' : 'Note moyenne des plateformes, par épisode';
  const labelEvery = episodes.length > 16 ? 5 : episodes.length > 10 ? 2 : 1;

  return html`<figure class="ep-chart" aria-label="${title}">
    <figcaption>${title} <span class="muted">(sur 10)</span></figcaption>
    <div class="ep-chart-plot">
      <div class="ep-chart-axis" aria-hidden="true"><span>10</span><span>5</span><span>0</span></div>
      <div class="ep-chart-area">
        <div class="ep-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="ep-chart-cols" style="--n:${episodes.length}">
          ${episodes.map((e, i) => {
            const v = values[i];
            const name = e.name || `Épisode ${e.number}`;
            const label = `Épisode ${e.number} – ${name} : ${v == null ? 'pas encore de note' : `${fmtScore(v)} sur 10`}`;
            const edge = i < 2 ? 'tip-left' : i > episodes.length - 3 ? 'tip-right' : '';
            return html`<a class="ep-chart-col ${edge}" href="/episode/${e.id}" aria-label="${label}">
              ${v != null ? html`<span class="ep-chart-bar" style="--v:${Math.max(2, v * 10)}%"></span>` : ''}
              <span class="ep-chart-tip" role="tooltip"><strong>É${e.number}</strong> ${name}<br />${v == null ? 'Pas encore de note' : `${fmtScore(v)} / 10`}</span>
            </a>`;
          })}
        </div>
        <div class="ep-chart-x" style="--n:${episodes.length}" aria-hidden="true">
          ${episodes.map((e, i) => html`<span>${i % labelEvery === 0 || i === episodes.length - 1 ? e.number : ''}</span>`)}
        </div>
      </div>
    </div>
  </figure>`;
}
