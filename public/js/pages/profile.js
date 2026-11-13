import { html } from '../html.js';
import { api } from '../api.js';
import { state, setUser, prefs } from '../store.js';
import { icon, grid, fmtDate, fmtScore, plural, poster, toast } from '../ui.js';
import { navigate, goLogin, canInstall, isStandalone, isIos } from '../app.js';

export default async function profile(ctx) {
  if (!state.user) return goLogin();
  ctx.setTitle('Mon profil');
  const u = state.user;
  const data = await api.get('/me/ratings');
  const theme = prefs.get('theme', 'auto');

  const premiumBox = u.isPremium
    ? html`<div class="panel panel-premium">
        <h2>${icon('crown', 18)} Membre Premium</h2>
        <p>Sans publicité · commentaires activés${u.premiumUntil ? html` · ${u.premiumProvider === 'stripe' ? 'renouvellement' : 'jusqu’au'} ${fmtDate(u.premiumUntil)}` : ''}</p>
        ${u.premiumProvider === 'stripe'
          ? html`<button class="btn btn-sm" data-action="portal">Gérer mon abonnement</button>`
          : u.premiumProvider === 'demo'
            ? html`<button class="btn btn-sm btn-ghost" data-action="cancel-demo">Arrêter le Premium (démo)</button>`
            : ''}
      </div>`
    : html`<div class="panel callout-premium">
        <h2>${icon('crown', 18)} Passez Premium</h2>
        <p>Supprimez les publicités et commentez vos films, séries et épisodes préférés.</p>
        <a class="btn btn-premium btn-sm" href="/premium">Voir l’offre · ${state.config.premium.priceLabel}</a>
      </div>`;

  const installBox = isStandalone()
    ? ''
    : canInstall()
      ? html`<div class="panel"><h2>${icon('download', 18)} Installer l’application</h2>
          <p class="muted">Ajoutez ${state.config.appName} à votre écran d’accueil, comme une application.</p>
          <button class="btn btn-sm" data-action="install">Installer</button></div>`
      : isIos()
        ? html`<div class="panel"><h2>${icon('download', 18)} Installer sur iPhone / iPad</h2>
            <p class="muted">Dans Safari, touchez le bouton <strong>Partager</strong> puis <strong>« Sur l’écran d’accueil »</strong>.</p></div>`
        : '';

  ctx.render(html`
    <div class="profile-head">
      <span class="avatar avatar-lg" aria-hidden="true">${u.username.slice(0, 1).toUpperCase()}</span>
      <div>
        <h1>${u.username}</h1>
        <p class="muted">${u.email} · membre depuis ${fmtDate(u.createdAt, { month: 'long', year: 'numeric' })}</p>
      </div>
    </div>

    <div class="stats">
      <div class="stat"><strong>${data.stats.titles}</strong><span>titres notés</span></div>
      <div class="stat"><strong>${data.stats.episodes}</strong><span>épisodes notés</span></div>
      <div class="stat"><strong>${fmtScore(data.stats.avg)}</strong><span>note moyenne</span></div>
      <div class="stat"><strong>${data.stats.comments}</strong><span>commentaires</span></div>
    </div>

    <div class="profile-panels">${premiumBox}${installBox}</div>

    ${data.episodesBySeries.length
      ? html`<section class="section"><h2>Mes séries suivies</h2>
          <ul class="series-progress">${data.episodesBySeries.map(
            (s) => html`<li><a href="/titre/${s.id}">
              <span class="sp-poster">${poster(s)}</span>
              <span><strong>${s.title}</strong><br /><span class="muted small">${plural(s.count, 'épisode noté', 'épisodes notés')} · moyenne ${fmtScore(s.score)}</span></span>
            </a></li>`,
          )}</ul></section>`
      : ''}

    <section class="section">
      <h2>Mes notes</h2>
      ${data.titles.length
        ? grid(data.titles, { reason: false })
        : html`<p class="muted">Vous n’avez encore rien noté. <a href="/films">Parcourez les films</a> ou <a href="/series">les séries</a>.</p>`}
    </section>

    <section class="section panel">
      <h2>Préférences</h2>
      <div class="setting">
        <span>Thème</span>
        <div class="segmented" role="group" aria-label="Thème">
          ${[
            ['auto', 'Automatique'],
            ['light', 'Clair'],
            ['dark', 'Sombre'],
          ].map(([v, l]) => html`<button data-action="theme" data-value="${v}" aria-pressed="${theme === v}">${l}</button>`)}
        </div>
      </div>
      <div class="setting-actions">
        <button class="btn btn-ghost" data-action="logout">${icon('logout', 16)} Se déconnecter</button>
        <button class="btn btn-ghost btn-danger" data-action="delete-account">${icon('trash', 16)} Supprimer mon compte</button>
      </div>
    </section>
  `);

  ctx.actions.portal = async () => {
    try {
      const { url } = await api.post('/subscription/portal');
      location.href = url;
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  ctx.actions['cancel-demo'] = async () => {
    const { user } = await api.post('/subscription/demo/cancel');
    setUser(user);
    toast('Premium désactivé');
    navigate('/profil', { replace: true });
  };
  ctx.actions['delete-account'] = async () => {
    const password = prompt('Cette action est définitive : vos notes et commentaires seront supprimés.\nConfirmez avec votre mot de passe :');
    if (!password) return;
    try {
      await api.del('/me', { password });
      setUser(null);
      toast('Compte supprimé');
      navigate('/');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}
