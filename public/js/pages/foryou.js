import { html } from '../html.js';
import { api, qs } from '../api.js';
import { state } from '../store.js';
import { grid, icon, emptyState } from '../ui.js';
import { adSlot } from '../ads.js';

const TABS = [
  ['', 'Tout'],
  ['movie', 'Films'],
  ['series', 'Séries'],
];

export default async function forYou(ctx) {
  ctx.setTitle('Pour vous');
  if (!state.user) {
    ctx.render(
      emptyState({
        title: 'Des suggestions rien que pour vous',
        text: 'Créez un compte et notez les films et séries que vous avez vus : nous vous proposerons des titres selon vos goûts.',
        action: html`<a class="btn btn-primary" href="/inscription">Créer mon compte</a>
          <a class="btn btn-ghost" href="/connexion">J’ai déjà un compte</a>`,
      }),
    );
    return;
  }
  const type = ctx.query.type || '';
  const data = await api.get(`/recommendations${qs({ type, limit: 36 })}`);
  ctx.render(html`
    <div class="page-head">
      <h1>${icon('spark', 24)} Pour vous</h1>
      <p class="muted">${data.personalized
        ? `Suggestions calculées à partir de vos notes (${data.basedOn} titre${data.basedOn > 1 ? 's' : ''} aimé${data.basedOn > 1 ? 's' : ''}), des titres liés et des goûts des membres qui vous ressemblent.`
        : 'Notez quelques titres pour obtenir des suggestions personnalisées. En attendant, voici les titres populaires.'}</p>
    </div>
    <div class="chips-scroll" role="tablist">
      ${TABS.map(([v, l]) => html`<a class="chip ${v === type ? 'active' : ''}" role="tab" aria-selected="${v === type}" href="/pour-vous${qs({ type: v })}">${l}</a>`)}
    </div>
    ${data.items.length ? grid(data.items.slice(0, 18)) : emptyState({ title: 'Rien à suggérer pour le moment' })}
    ${data.items.length > 18 ? html`${adSlot('infeed')}${grid(data.items.slice(18))}` : adSlot('infeed')}
  `);
}
