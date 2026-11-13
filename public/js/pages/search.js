import { html } from '../html.js';
import { api, qs } from '../api.js';
import { state } from '../store.js';
import { grid, icon, toast, placeholder } from '../ui.js';
import { navigate, goLogin } from '../app.js';

export default async function search(ctx) {
  const q = (ctx.query.q || '').trim();
  ctx.setTitle(q ? `Recherche « ${q} »` : 'Recherche');
  const input = document.getElementById('q');
  if (input) input.value = q;

  const form = html`<form class="search-page-form" data-form="search" role="search">
    <label class="visually-hidden" for="q2">Rechercher un film ou une série</label>
    <input id="q2" name="q" type="search" value="${q}" placeholder="Rechercher un film ou une série…" autocomplete="off" enterkeyhint="search" />
    <button class="btn btn-primary" type="submit">${icon('search', 16)} Rechercher</button>
  </form>`;

  if (q.length < 2) {
    ctx.render(html`<div class="page-head"><h1>Recherche</h1></div>${form}
      <p class="muted">Tapez au moins 2 caractères. Si un titre n’est pas encore dans le catalogue, vous pourrez l’ajouter.</p>`);
    if (!matchMedia('(hover: none)').matches) document.getElementById('q2')?.focus();
    return;
  }

  ctx.render(html`<div class="page-head"><h1>Recherche</h1></div>${form}<p class="muted">Recherche…</p>`);
  const { local } = await api.get(`/search${qs({ q })}`);

  const renderAll = (remote, loadingRemote) => {
    ctx.render(html`
      <div class="page-head"><h1>Recherche</h1></div>
      ${form}
      <section class="section">
        <h2>Dans le catalogue <span class="muted">(${local.length})</span></h2>
        ${local.length ? grid(local) : html`<p class="muted">Aucun titre trouvé pour « ${q} ».</p>`}
      </section>
      <section class="section">
        <h2>Ajouter depuis les bases de données</h2>
        ${loadingRemote
          ? html`<p class="muted">Recherche sur TMDB / TVmaze…</p>`
          : remote.length
            ? html`<ul class="remote-list">${remote.map(remoteItem)}</ul>`
            : html`<p class="muted">Aucun autre résultat.${!state.config.providers.tmdb
                ? ' (Les films nécessitent une clé TMDB côté serveur.)'
                : ''}</p>`}
      </section>`);
  };
  renderAll([], true);

  const { remote } = await api.get(`/search/remote${qs({ q })}`).catch(() => ({ remote: [] }));
  if (!ctx.isCurrent()) return;
  renderAll(remote, false);

  ctx.actions.import = async (btn) => {
    if (!state.user) return goLogin('Connectez-vous pour ajouter un titre.');
    btn.disabled = true;
    btn.textContent = 'Ajout…';
    try {
      const { id } = await api.post('/import', {
        provider: btn.dataset.provider,
        providerId: Number(btn.dataset.pid),
        type: btn.dataset.type,
      });
      toast('Titre ajouté au catalogue', 'success');
      navigate(`/titre/${id}`);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Ajouter';
      toast(err.message, 'error');
    }
  };
}

function remoteItem(r) {
  return html`<li class="remote-item">
    <div class="remote-poster">${r.poster ? html`<img src="${r.poster}" alt="" loading="lazy" data-ph="${r.title}" />` : placeholder(r.title)}</div>
    <div class="remote-info">
      <strong>${r.title}</strong>
      <span class="muted">${[r.type === 'movie' ? 'Film' : 'Série', r.year, r.provider === 'tmdb' ? 'TMDB' : 'TVmaze'].filter(Boolean).join(' · ')}</span>
    </div>
    <button class="btn btn-sm" data-action="import" data-provider="${r.provider}" data-pid="${r.providerId}" data-type="${r.type}">
      ${icon('plus', 14)} Ajouter</button>
  </li>`;
}

