// Section commentaires : lecture pour tous, écriture réservée aux membres Premium.
import { html } from './html.js';
import { api, qs } from './api.js';
import { state } from './store.js';
import { icon, toast, fmtDate } from './ui.js';

export function commentsSection({ titleId, episodeId }) {
  const key = episodeId ? `e${episodeId}` : `t${titleId}`;
  const u = state.user;
  let composer;
  if (!u) {
    composer = html`<div class="callout">
      <div>${icon('chat', 20)}</div>
      <div><strong>Rejoignez la discussion</strong>
        <p>Les commentaires sont réservés aux membres Premium. <a href="/connexion">Connectez-vous</a> ou
        <a href="/premium">découvrez Premium</a>.</p></div>
    </div>`;
  } else if (!u.isPremium) {
    composer = html`<div class="callout callout-premium">
      <div>${icon('crown', 20)}</div>
      <div><strong>Commenter avec Premium</strong>
        <p>Passez Premium pour publier vos avis, sans aucune publicité.</p></div>
      <a class="btn btn-premium btn-sm" href="/premium">Passer Premium</a>
    </div>`;
  } else {
    composer = html`<form class="comment-form" data-form="comment-${key}">
      <label class="visually-hidden" for="cbody-${key}">Votre commentaire</label>
      <textarea id="cbody-${key}" name="body" rows="3" maxlength="2000" required placeholder="Partagez votre avis…"></textarea>
      <div class="comment-form-row">
        <label class="check"><input type="checkbox" name="spoiler" value="1" /> Contient des spoilers</label>
        <button class="btn btn-primary btn-sm" type="submit">Publier</button>
      </div>
    </form>`;
  }
  return html`<section class="section comments" id="commentaires">
    <h2>${icon('chat', 20)} Commentaires</h2>
    ${composer}
    <div class="comment-list" data-comments="${key}"><p class="muted">Chargement des commentaires…</p></div>
  </section>`;
}

function commentItem(c) {
  return html`<article class="comment ${c.spoiler ? 'is-spoiler' : ''}">
    <header>
      <span class="avatar avatar-sm" aria-hidden="true">${c.author.username.slice(0, 1).toUpperCase()}</span>
      <strong>${c.author.username}</strong>
      ${c.author.premium ? html`<span class="premium-dot" title="Membre Premium">${icon('crown', 12)}</span>` : ''}
      ${c.score != null ? html`<span class="chip chip-sm">${icon('star', 11)} ${c.score}/10</span>` : ''}
      <time class="muted" datetime="${new Date(c.createdAt).toISOString()}">${fmtDate(c.createdAt)}</time>
      ${c.canDelete
        ? html`<button class="icon-btn icon-btn-sm" data-action="delete-comment" data-cid="${c.id}" aria-label="Supprimer le commentaire">${icon('trash', 15)}</button>`
        : ''}
    </header>
    ${c.spoiler
      ? html`<button class="spoiler-toggle" data-action="show-spoiler">Spoiler — toucher pour afficher</button>`
      : ''}
    <p class="comment-body">${c.body}</p>
  </article>`;
}

/** Charge la liste et branche les actions (à appeler après le rendu de la page). */
export async function mountComments(ctx, { titleId, episodeId }) {
  const key = episodeId ? `e${episodeId}` : `t${titleId}`;
  const load = async () => {
    const el = document.querySelector(`[data-comments="${key}"]`);
    if (!el) return;
    try {
      const data = await api.get(`/comments${qs({ title: episodeId ? null : titleId, episode: episodeId })}`);
      if (!ctx.isCurrent()) return;
      el.innerHTML = String(
        data.items.length
          ? html`${data.items.map(commentItem)}`
          : html`<p class="muted">Aucun commentaire pour l’instant.</p>`,
      );
    } catch (err) {
      el.innerHTML = String(html`<p class="muted">${err.message}</p>`);
    }
  };

  ctx.actions[`submit:comment-${key}`] = async (form, data) => {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api.post('/comments', { titleId, episodeId, body: data.body, spoiler: Boolean(data.spoiler) });
      form.reset();
      toast('Commentaire publié', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
  ctx.actions['delete-comment'] = async (btn) => {
    if (!confirm('Supprimer ce commentaire ?')) return;
    try {
      await api.del(`/comments/${btn.dataset.cid}`);
      btn.closest('.comment')?.remove();
      toast('Commentaire supprimé');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  ctx.actions['show-spoiler'] = (btn) => {
    btn.closest('.comment')?.classList.remove('is-spoiler');
    btn.remove();
  };
  await load();
}
