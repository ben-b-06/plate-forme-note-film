// Gabarits HTML avec échappement automatique (protection XSS).
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(v) {
    this.v = v;
  }
  toString() {
    return this.v;
  }
}

/** Marque une chaîne comme HTML sûr (à n'utiliser qu'avec du contenu maîtrisé). */
export const raw = (v) => new Raw(String(v));

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.v;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

/** html`<p>${texte}</p>` : toutes les valeurs sont échappées sauf raw()/html imbriqués. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}
