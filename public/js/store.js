// État global minimal (utilisateur connecté, configuration).
const listeners = new Set();

export const state = {
  user: null,
  config: {
    appName: 'CinéNote',
    ads: {},
    premium: { priceLabel: '', stripeEnabled: false, demoEnabled: false },
    providers: {},
  },
};

export function setUser(user) {
  state.user = user || null;
  for (const fn of listeners) fn(state);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isPremium = () => Boolean(state.user?.isPremium);

// Préférences locales (thème…) : le stockage peut être indisponible (navigation privée).
export const prefs = {
  get(key, fallback = null) {
    try {
      return localStorage.getItem(`cn:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`cn:${key}`);
      else localStorage.setItem(`cn:${key}`, value);
    } catch {
      /* ignoré */
    }
  },
};
