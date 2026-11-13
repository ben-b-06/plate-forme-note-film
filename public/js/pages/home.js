import { html } from '../html.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { rail, skeletonRail, episodeCard, icon } from '../ui.js';
import { adSlot } from '../ads.js';

export default async function home(ctx) {
  ctx.setTitle(null);
  ctx.render(html`${hero()}${skeletonRail()}${skeletonRail()}`);
  const d = await api.get('/home');
  const u = state.user;

  ctx.render(html`
    ${hero()}
    ${rail('Reprendre vos séries', d.continueWatching, {
      render: (x) => episodeCard(x, { cta: 'Noter le suivant' }),
      subtitle: 'Le prochain épisode à noter, là où vous vous êtes arrêté.',
    })}
    ${u && d.recommendations.length
      ? rail('Recommandé pour vous', d.recommendations, { href: '/pour-vous', subtitle: 'D’après les titres que vous avez aimés.' })
      : u
        ? html`<section class="section callout">
            <div>${icon('spark', 22)}</div>
            <div><strong>Vos suggestions arrivent !</strong>
              <p>Notez quelques films ou séries que vous avez vus : nous vous proposerons des titres selon vos goûts.</p></div>
          </section>`
        : ''}
    ${adSlot('banner')}
    ${rail('Films du moment', d.trendingMovies, { href: '/films' })}
    ${rail('Séries du moment', d.trendingSeries, { href: '/series' })}
    ${rail('Épisodes sortis cette semaine', d.recentEpisodes, { render: (x) => episodeCard(x) })}
    ${rail('Les mieux notés sur les plateformes', d.topRated, { subtitle: 'Moyenne IMDb, Rotten Tomatoes, Metacritic, TMDB et TVmaze.' })}
    ${rail('Coups de cœur de la communauté', d.topCommunity)}
    ${adSlot('banner')}
  `);
}

function hero() {
  if (state.user) return '';
  return html`<section class="hero-home">
    <h1>Notez chaque film, chaque série… et chaque épisode.</h1>
    <p>Comparez les notes IMDb, Rotten Tomatoes, Metacritic, TMDB et TVmaze, suivez vos séries épisode par épisode
      et découvrez des titres choisis selon vos goûts.</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="/inscription">Créer mon compte gratuit</a>
      <a class="btn btn-ghost" href="/series">Explorer les séries</a>
    </div>
  </section>`;
}
