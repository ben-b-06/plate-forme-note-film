import { html } from '../html.js';
import { api, qs } from '../api.js';
import { card, icon, emptyState } from '../ui.js';
import { adSlot, activateAds } from '../ads.js';
import { navigate } from '../app.js';

const SORTS = [
  ['popular', 'Popularité'],
  ['rating', 'Note des plateformes'],
  ['community', 'Note de la communauté'],
  ['recent', 'Plus récents'],
  ['title', 'Titre (A–Z)'],
];

export default async function browse(ctx, type) {
  const label = type === 'movie' ? 'Films' : 'Séries';
  ctx.setTitle(label);
  const genre = ctx.query.genre || '';
  const sort = ctx.query.sort || 'popular';
  let page = 1;

  const [genres, list] = await Promise.all([
    api.get(`/genres${qs({ type })}`),
    api.get(`/titles${qs({ type, genre, sort, page })}`),
  ]);
  let items = list.items;
  let total = list.total;

  const base = type === 'movie' ? '/films' : '/series';
  const link = (g, s) => `${base}${qs({ genre: g, sort: s === 'popular' ? '' : s })}`;

  function gridHtml() {
    // Un encart publicitaire toutes les 18 cartes (non Premium).
    const chunks = [];
    for (let i = 0; i < items.length; i += 18) {
      chunks.push(html`<div class="grid">${items.slice(i, i + 18).map((t) => card(t, { showType: false }))}</div>`);
      if (i + 18 < items.length || items.length <= 18) chunks.push(adSlot('infeed'));
    }
    return chunks;
  }

  function render() {
    ctx.render(html`
      <div class="page-head">
        <h1>${label}</h1>
        <p class="muted">${total} ${type === 'movie' ? 'films' : 'séries'}${genre ? ` · ${genre}` : ''}</p>
      </div>
      <div class="filters">
        <div class="chips-scroll" role="list" aria-label="Genres">
          <a role="listitem" class="chip ${!genre ? 'active' : ''}" href="${link('', sort)}">Tous</a>
          ${genres.genres.map(
            (g) => html`<a role="listitem" class="chip ${g.name === genre ? 'active' : ''}" href="${link(g.name, sort)}">${g.name}</a>`,
          )}
        </div>
        <label class="select">
          <span class="visually-hidden">Trier par</span>
          <select data-sort>
            ${SORTS.map(([v, l]) => html`<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`)}
          </select>
        </label>
      </div>
      ${items.length ? gridHtml() : emptyState({ title: 'Aucun résultat', text: 'Essayez un autre genre.' })}
      ${items.length < total
        ? html`<div class="center"><button class="btn" data-action="more">${icon('plus', 16)} Afficher plus</button></div>`
        : ''}
    `);
    document.querySelector('[data-sort]')?.addEventListener('change', (e) => navigate(link(genre, e.target.value), { replace: true }));
  }

  ctx.actions.more = async (btn) => {
    btn.disabled = true;
    page++;
    const next = await api.get(`/titles${qs({ type, genre, sort, page })}`);
    items = items.concat(next.items);
    total = next.total;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    activateAds();
  };

  render();
}
