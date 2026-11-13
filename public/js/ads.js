// Emplacements publicitaires : Google AdSense si configuré, sinon encart « maison »
// qui promeut l'abonnement Premium. Jamais affiché aux membres Premium.
import { html } from './html.js';
import { state, isPremium } from './store.js';
import { icon } from './ui.js';

let scriptLoaded = false;

export function adSlot(kind = 'banner') {
  if (isPremium()) return '';
  const ads = state.config.ads || {};
  const slot = kind === 'infeed' ? ads.slotInfeed || ads.slotBanner : ads.slotBanner;
  if (ads.adsenseClient && slot) {
    return html`<aside class="ad-slot ad-${kind}" aria-label="Publicité">
      <span class="ad-label">Publicité</span>
      <ins class="adsbygoogle" style="display:block" data-ad-client="${ads.adsenseClient}" data-ad-slot="${slot}"
        data-ad-format="auto" data-full-width-responsive="true"></ins>
    </aside>`;
  }
  return html`<aside class="ad-slot ad-house ad-${kind}" aria-label="Publicité">
    <span class="ad-label">Publicité</span>
    <div class="ad-house-body">
      <span class="ad-house-icon">${icon('crown', 22)}</span>
      <div>
        <strong>Envie d’une expérience sans pub ?</strong>
        <p>Premium supprime les publicités et vous permet de commenter films, séries et épisodes.</p>
      </div>
      <a class="btn btn-premium" href="/premium">Découvrir Premium</a>
    </div>
  </aside>`;
}

/** À appeler après chaque rendu : charge le script AdSense et remplit les nouveaux emplacements. */
export function activateAds(root = document) {
  const ads = state.config.ads || {};
  if (isPremium() || !ads.adsenseClient) return;
  const slots = root.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])');
  if (!slots.length) return;
  if (!scriptLoaded) {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.adsenseClient)}`;
    document.head.appendChild(s);
    scriptLoaded = true;
  }
  slots.forEach(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* bloqueur de pub, etc. */
    }
  });
}
