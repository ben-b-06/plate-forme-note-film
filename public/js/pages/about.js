import { html } from '../html.js';
import { state } from '../store.js';

export default async function about(ctx) {
  ctx.setTitle('À propos');
  const name = state.config.appName;
  const ads = Boolean(state.config.ads?.adsenseClient);
  ctx.render(html`<article class="prose">
    <h1>À propos de ${name}</h1>
    <p>${name} permet de noter les films, les séries et chacun de leurs épisodes, de comparer les notes publiées
      par les grandes plateformes et de recevoir des suggestions selon vos goûts.</p>

    <h2>Sources des données</h2>
    <ul>
      <li><strong>TMDB</strong> — fiches, affiches, tendances et recommandations. <em>This product uses the TMDB API but is not
        endorsed or certified by TMDB.</em></li>
      <li><strong>TVmaze</strong> — séries, saisons, épisodes et notes, sous licence
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>.</li>
      <li><strong>OMDb API</strong> — notes IMDb, Rotten Tomatoes et Metacritic.</li>
    </ul>
    <p>Les notes des plateformes sont affichées à titre indicatif, avec un lien vers leur source, et mises à jour
      automatiquement plusieurs fois par jour. IMDb, Rotten Tomatoes, Metacritic, TMDB et TVmaze sont des marques
      de leurs propriétaires respectifs ; ${name} n’est affilié à aucune d’entre elles.</p>

    <h2>Confidentialité</h2>
    <ul>
      <li>Un cookie de session strictement nécessaire est utilisé pour vous garder connecté.</li>
      <li>Vos notes et commentaires sont associés à votre pseudo. Vous pouvez supprimer votre compte à tout moment
        depuis votre profil : toutes vos données sont alors effacées.</li>
      ${ads
        ? html`<li>Pour les membres gratuits, des publicités sont diffusées par Google AdSense, qui peut utiliser des
            cookies selon votre consentement. Les membres Premium ne voient aucune publicité.</li>`
        : html`<li>Aucun cookie publicitaire n’est déposé pour le moment.</li>`}
      <li>Les paiements Premium sont traités par Stripe ; nous ne stockons jamais vos données bancaires.</li>
    </ul>

    <h2>Mentions légales</h2>
    <p class="muted">À compléter par l’éditeur du service : raison sociale, adresse, contact, directeur de la
      publication et hébergeur.</p>
  </article>`);
}
