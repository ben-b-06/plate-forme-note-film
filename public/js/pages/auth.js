import { html } from '../html.js';
import { api } from '../api.js';
import { state, setUser } from '../store.js';
import { toast } from '../ui.js';
import { navigate } from '../app.js';

function safeReturn(url) {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

function errorBox(msg) {
  return msg ? html`<p class="form-error" role="alert">${msg}</p>` : '';
}

export async function login(ctx) {
  ctx.setTitle('Connexion');
  const retour = safeReturn(ctx.query.retour);
  if (state.user) return navigate(retour, { replace: true });
  const render = (err, values = {}) =>
    ctx.render(html`<div class="auth-card">
      <h1>Connexion</h1>
      <p class="muted">Retrouvez vos notes et vos suggestions sur tous vos appareils.</p>
      ${errorBox(err)}
      <form data-form="login" class="form">
        <label>E-mail ou pseudo<input name="email" autocomplete="username" required value="${values.email || ''}" /></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="btn btn-primary btn-block" type="submit">Se connecter</button>
      </form>
      <p class="muted center">Pas encore de compte ? <a href="/inscription${retour !== '/' ? `?retour=${encodeURIComponent(retour)}` : ''}">Inscrivez-vous</a></p>
    </div>`);
  render();
  ctx.actions['submit:login'] = async (form, values) => {
    form.querySelector('button').disabled = true;
    try {
      const { user } = await api.post('/auth/login', values);
      setUser(user);
      toast(`Bienvenue ${user.username} !`, 'success');
      navigate(retour, { replace: true });
    } catch (err) {
      render(err.message, values);
    }
  };
}

export async function register(ctx) {
  ctx.setTitle('Inscription');
  const retour = safeReturn(ctx.query.retour);
  if (state.user) return navigate(retour, { replace: true });
  const render = (err, values = {}) =>
    ctx.render(html`<div class="auth-card">
      <h1>Créer un compte</h1>
      <p class="muted">Gratuit. Notez films, séries et épisodes, et recevez des suggestions personnalisées.</p>
      ${errorBox(err)}
      <form data-form="register" class="form">
        <label>Pseudo<input name="username" autocomplete="nickname" required minlength="3" maxlength="24" value="${values.username || ''}" /></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" required value="${values.email || ''}" /></label>
        <label>Mot de passe <span class="muted small">(8 caractères minimum)</span>
          <input name="password" type="password" autocomplete="new-password" required minlength="8" /></label>
        <button class="btn btn-primary btn-block" type="submit">Créer mon compte</button>
        <p class="muted small">En créant un compte, vous acceptez nos <a href="/a-propos">conditions et notre politique de confidentialité</a>.</p>
      </form>
      <p class="muted center">Déjà inscrit ? <a href="/connexion">Connectez-vous</a></p>
    </div>`);
  render();
  ctx.actions['submit:register'] = async (form, values) => {
    form.querySelector('button').disabled = true;
    try {
      const { user } = await api.post('/auth/register', values);
      setUser(user);
      toast('Compte créé, bienvenue !', 'success');
      navigate(retour, { replace: true });
    } catch (err) {
      render(err.message, values);
    }
  };
}
