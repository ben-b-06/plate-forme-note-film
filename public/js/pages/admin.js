import { html } from '../html.js';
import { api } from '../api.js';
import { state } from '../store.js';
import { icon, fmtDateTime, toast, emptyState } from '../ui.js';

const STATUS = { ok: 'OK', partielle: 'Partielle', erreur: 'Erreur', running: 'En cours', interrompue: 'Interrompue', ignorée: 'Ignorée' };

export default async function admin(ctx) {
  ctx.setTitle('Administration');
  if (!state.user?.isAdmin) {
    ctx.render(emptyState({ title: 'Accès réservé', text: 'Ajoutez votre e-mail à ADMIN_EMAILS côté serveur.' }));
    return;
  }
  const load = async () => {
    const d = await api.get('/admin/status');
    if (!ctx.isCurrent()) return;
    const s = d.sync;
    const c = d.counts;
    ctx.render(html`
      <div class="page-head"><h1>${icon('shield', 22)} Administration</h1></div>
      <div class="stats">
        ${[
          ['Films', c.movies],
          ['Séries', c.series],
          ['Épisodes', c.episodes],
          ['Membres', c.users],
          ['Premium', c.premium],
          ['Notes', c.ratings],
          ['Notes externes', c.externalRatings],
          ['Commentaires', c.comments],
        ].map(([l, v]) => html`<div class="stat"><strong>${v}</strong><span>${l}</span></div>`)}
      </div>
      <section class="section panel">
        <div class="section-head">
          <h2>Mise à jour automatique de la base</h2>
          <button class="btn btn-sm" data-action="sync" ${s.running ? 'disabled' : ''}>${icon('refresh', 16)} ${s.running ? 'En cours…' : 'Lancer maintenant'}</button>
        </div>
        <p class="muted">
          ${s.enabled ? `Toutes les ${s.intervalHours} h` : 'Désactivée (SYNC_ENABLED=false)'} ·
          dernière : ${fmtDateTime(s.lastRunAt)} · prochaine : ${fmtDateTime(s.nextRunAt)}
        </p>
        <p class="sources">
          ${[
            ['TMDB', s.providers.tmdb, 'TMDB_API_KEY'],
            ['TVmaze', s.providers.tvmaze, ''],
            ['OMDb (IMDb, Rotten Tomatoes, Metacritic)', s.providers.omdb, 'OMDB_API_KEY'],
          ].map(
            ([n, on, key]) => html`<span class="chip ${on ? 'chip-ok' : ''}">${on ? icon('check', 14) : icon('close', 14)} ${n}${!on && key ? ` — ${key} manquante` : ''}</span>`,
          )}
        </p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Début</th><th>Origine</th><th>Statut</th><th>Nouveaux</th><th>Mis à jour</th><th>Épisodes</th><th>Notes</th><th>Détails</th></tr></thead>
            <tbody>
              ${s.runs.map(
                (r) => html`<tr>
                  <td>${fmtDateTime(r.startedAt)}</td>
                  <td>${r.reason}</td>
                  <td><span class="status status-${r.status}">${STATUS[r.status] || r.status}</span></td>
                  <td>${r.stats?.imported ?? ''}</td>
                  <td>${(r.stats?.updated ?? 0) + (r.stats?.matched ?? 0) || ''}</td>
                  <td>${r.stats?.episodes ?? ''}</td>
                  <td>${r.stats?.ratings ?? ''}</td>
                  <td class="small">${[...(r.stats?.errors || []), ...(r.stats?.warnings || [])].slice(0, 3).join(' · ') || r.error || ''}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>`);
  };
  ctx.actions.sync = async (btn) => {
    btn.disabled = true;
    await api.post('/admin/sync').catch((e) => toast(e.message, 'error'));
    toast('Synchronisation lancée');
    setTimeout(() => ctx.isCurrent() && load(), 1500);
  };
  await load();
}
