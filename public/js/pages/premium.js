import { html } from '../html.js';
import { api } from '../api.js';
import { state, setUser } from '../store.js';
import { icon, toast, fmtDate } from '../ui.js';
import { navigate, goLogin } from '../app.js';

export default async function premium(ctx) {
  ctx.setTitle('Premium');
  const cfg = state.config.premium;
  const u = state.user;

  // Retour de Stripe : le webhook peut prendre quelques secondes, on recharge l'utilisateur.
  if (ctx.query.statut === 'succes' && u && !u.isPremium) {
    for (let i = 0; i < 5 && ctx.isCurrent(); i++) {
      const { user } = await api.get('/me');
      if (user?.isPremium) {
        setUser(user);
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const user = state.user;

  const notice =
    ctx.query.statut === 'succes'
      ? html`<p class="notice notice-success">${icon('check', 16)} Merci ! Votre abonnement Premium est ${user?.isPremium ? 'actif' : 'en cours d’activation'}.</p>`
      : ctx.query.statut === 'annule'
        ? html`<p class="notice">Paiement annulé, aucun montant n’a été débité.</p>`
        : '';

  let cta;
  if (user?.isPremium) {
    cta = html`<p class="premium-active">${icon('crown', 18)} Vous êtes Premium${user.premiumUntil ? ` jusqu’au ${fmtDate(user.premiumUntil)}` : ''}.</p>
      <a class="btn" href="/profil">Gérer depuis mon profil</a>`;
  } else if (cfg.stripeEnabled) {
    cta = html`<button class="btn btn-premium btn-block" data-action="subscribe">S’abonner · ${cfg.priceLabel}</button>
      <p class="muted small center">Paiement sécurisé par Stripe. Sans engagement, résiliable à tout moment.</p>`;
  } else if (cfg.demoEnabled) {
    cta = html`<button class="btn btn-premium btn-block" data-action="demo">Activer Premium (mode démo)</button>
      <p class="muted small center">Mode démonstration : aucun paiement. Configurez Stripe pour encaisser de vrais abonnements.</p>`;
  } else {
    cta = html`<p class="muted">Les abonnements ne sont pas encore ouverts. Revenez bientôt !</p>`;
  }

  ctx.render(html`
    <div class="premium-page">
      ${notice}
      <div class="premium-card">
        <p class="eyebrow">${icon('crown', 16)} ${state.config.appName} Premium</p>
        <h1>Le cinéma, sans interruption.</h1>
        <p class="premium-price">${cfg.priceLabel}</p>
        <ul class="benefits">
          <li>${icon('check', 18)} <span><strong>Aucune publicité</strong>, sur le site et l’application</span></li>
          <li>${icon('check', 18)} <span><strong>Commentaires</strong> sur les films, séries et chaque épisode</span></li>
          <li>${icon('check', 18)} <span>Badge Premium visible sur vos avis</span></li>
          <li>${icon('check', 18)} <span>Vous soutenez le développement de l’application</span></li>
        </ul>
        ${cta}
      </div>
      <div class="compare">
        <div class="panel">
          <h2>Gratuit</h2>
          <ul class="plain">
            <li>Notes des films, séries et épisodes</li>
            <li>Suggestions personnalisées</li>
            <li>Notes IMDb, Rotten Tomatoes, Metacritic…</li>
            <li>Lecture des commentaires</li>
            <li class="muted">Avec publicités</li>
          </ul>
        </div>
        <div class="panel panel-premium">
          <h2>Premium</h2>
          <ul class="plain">
            <li>Tout le gratuit</li>
            <li><strong>Sans publicité</strong></li>
            <li><strong>Écriture de commentaires</strong></li>
          </ul>
        </div>
      </div>
    </div>
  `);

  ctx.actions.subscribe = async (btn) => {
    if (!state.user) return goLogin('Connectez-vous pour vous abonner.');
    btn.disabled = true;
    try {
      const { url } = await api.post('/subscription/checkout');
      location.href = url;
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  };
  ctx.actions.demo = async (btn) => {
    if (!state.user) return goLogin('Connectez-vous pour activer Premium.');
    btn.disabled = true;
    try {
      const { user: updated } = await api.post('/subscription/demo');
      setUser(updated);
      toast('Premium activé : plus de pub, commentaires débloqués !', 'success');
      navigate('/premium', { replace: true });
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  };
}
