# CinéNote — notez films, séries… et chaque épisode

Application web installable (PWA) qui fonctionne **sur Android, iPhone/iPad et navigateur** avec un seul code.

| Fonction | Détail |
|---|---|
| **Noter** | Films, séries **et chaque épisode** (note de 1 à 10), graphique des notes par épisode, « Reprendre vos séries » (prochain épisode à noter) |
| **Suggestions** | Page « Pour vous » : recommandations calculées à partir des titres aimés (genres, titres liés TMDB, goûts des membres qui vous ressemblent), avec la raison affichée (« Parce que vous avez aimé… ») |
| **Notes des plateformes** | IMDb, Rotten Tomatoes, Metacritic (via OMDb), TMDB et TVmaze, pour les titres **et les épisodes** + note de la communauté |
| **Publicité** | Emplacements Google AdSense (ou encart « maison » vers Premium tant qu’AdSense n’est pas configuré) |
| **Premium** | Abonnement Stripe : **sans pub + possibilité de commenter** (films, séries, épisodes, avec option spoiler) |
| **Base à jour** | Synchronisation automatique (toutes les 6 h par défaut) : tendances, nouveautés, nouveaux épisodes, notes des plateformes |
| **Comptes** | Inscription / connexion, profil, statistiques, suppression du compte (RGPD), thème clair/sombre |
| **Admin** | Page `/admin` : chiffres clés, historique des mises à jour, bouton « Lancer maintenant » |

## Démarrage rapide

Prérequis : **Node.js 22.13 ou plus récent** (aucune base de données à installer : SQLite est intégré à Node).

```bash
npm install
npm start            # http://localhost:3000
```

Au premier lancement, un catalogue de départ (≈ 60 films et séries connus) est importé, puis la mise à jour
automatique complète les affiches, épisodes et notes. Sans clé d’API, seul TVmaze (séries) est utilisé ;
ajoutez les clés TMDB et OMDb pour avoir tout le catalogue et toutes les notes (voir ci-dessous).

Pour tester avec une fausse communauté (comptes `demo_*`, mot de passe `demo-demo-demo`) :

```bash
npm run seed -- --demo   # jamais en production
```

Le Premium fonctionne en **mode démo** (sans paiement) tant que Stripe n’est pas configuré et que l’on n’est pas en production.

Copiez `.env.example` en `.env` pour configurer l’application (le fichier est lu automatiquement).

## Récupérer les notes des plateformes

| Source | Clé | Apporte |
|---|---|---|
| [TVmaze](https://www.tvmaze.com/api) | aucune | Séries, saisons, épisodes, affiches, note TVmaze par série et par épisode |
| [TMDB](https://www.themoviedb.org/settings/api) | `TMDB_API_KEY` (gratuite) | Films + séries **en français**, tendances, recommandations, note TMDB par titre et par épisode |
| [OMDb](https://www.omdbapi.com/apikey.aspx) | `OMDB_API_KEY` (gratuite : 1 000 req/jour, ou payante) | Notes **IMDb, Rotten Tomatoes, Metacritic**, note IMDb de chaque épisode |

Les titres sont reliés entre sources par leur identifiant IMDb ; les doublons éventuels sont fusionnés
automatiquement (notes et commentaires des membres conservés). Une recherche peut aussi interroger TMDB / TVmaze
et **ajouter à la demande** un titre absent du catalogue.

> Attribution obligatoire (déjà présente sur la page « À propos ») : TMDB (« This product uses the TMDB API but is
> not endorsed or certified by TMDB ») et TVmaze (licence CC BY-SA).

## Mise à jour automatique de la base

- Le serveur vérifie toutes les 15 min si une mise à jour est due (`SYNC_INTERVAL_HOURS`, 6 h par défaut) et la lance.
  Chaque passage : tendances et films/séries populaires (TMDB), détails en français + recommandations,
  épisodes et notes (TVmaze), séries diffusées aujourd’hui en France / aux États-Unis, puis notes IMDb / Rotten
  Tomatoes / Metacritic (OMDb, quota respecté).
- Si une source est en panne, les autres continuent ; l’historique est visible sur `/admin`.
- Si votre hébergeur met l’application en veille, déclenchez-la depuis un cron externe (cron-job.org, tâche
  planifiée de l’hébergeur…) :
  ```bash
  curl -X POST -H "Authorization: Bearer $SYNC_SECRET" https://votre-domaine/api/cron/sync
  ```
  ou exécutez `npm run sync` (passage unique puis arrêt).

## Publicité (gagner de l’argent)

1. Créez un compte [Google AdSense](https://adsense.google.com), ajoutez votre domaine et créez deux blocs
   d’annonces « display » (bannière et in-feed).
2. Renseignez `ADSENSE_CLIENT=ca-pub-…`, `ADSENSE_SLOT_BANNER` et `ADSENSE_SLOT_INFEED`.
   Le fichier `/ads.txt` est servi automatiquement.
3. **Europe / RGPD** : activez dans AdSense le message de consentement Google (« Confidentialité et messages »,
   CMP certifiée TCF). Il s’affiche automatiquement aux visiteurs concernés.

Les publicités ne sont jamais montrées aux membres Premium.

## Abonnement Premium (sans pub + commentaires)

1. Dans [Stripe](https://dashboard.stripe.com) : créez un produit « Premium » avec un **prix récurrent**
   (ex. 2,99 €/mois) → copiez son identifiant `price_…` dans `STRIPE_PRICE_ID`.
2. `STRIPE_SECRET_KEY` = clé secrète (`sk_live_…` ou `sk_test_…` pour tester).
3. Développeurs → Webhooks → ajoutez l’URL `https://votre-domaine/api/stripe/webhook` avec les événements
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid` → copiez le secret `whsec_…` dans `STRIPE_WEBHOOK_SECRET`.
4. Activez le **portail client** Stripe (Paramètres → Facturation → Portail client) : les membres y gèrent ou
   résilient leur abonnement depuis leur profil.
5. Ajustez `PREMIUM_PRICE_LABEL` pour l’affichage du prix.

## Android, iPhone et site web

L’application est une **PWA** : le même site s’installe comme une app.

- **Android (Chrome)** : bouton « Installer » dans le profil, ou menu ⋮ → « Installer l’application ».
- **iPhone / iPad (Safari)** : Partager → « Sur l’écran d’accueil ».
- **Ordinateur** : icône d’installation dans la barre d’adresse de Chrome / Edge.

Publication dans les stores (optionnel) :

- **Google Play** : emballez la PWA avec [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (Trusted Web
  Activity), qui réutilise le manifeste `public/manifest.webmanifest`.
- **App Store** : emballez avec [Capacitor](https://capacitorjs.com). Attention : Apple impose son propre système
  de paiement (achats intégrés) pour un abonnement vendu dans une app de l’App Store, et la publicité y passe
  plutôt par AdMob. Sur le site/PWA, Stripe et AdSense restent utilisables.

## Déploiement

L’application est un seul serveur Node + un fichier SQLite : il faut un hébergement avec **disque persistant**
et **HTTPS** (indispensable pour l’installation PWA et les cookies sécurisés).

- **Docker** : `docker build -t cinenote . && docker run -p 3000:3000 -v cinenote-data:/data --env-file .env cinenote`
- **Render** : le fichier `render.yaml` crée le service avec un disque (New + → Blueprint).
- Variables minimales en production : `NODE_ENV=production`, `PUBLIC_URL`, `ADMIN_EMAILS`, `TMDB_API_KEY`,
  `OMDB_API_KEY`, `SYNC_SECRET`, puis AdSense et Stripe.
- Sauvegardez régulièrement le fichier `/data/app.db`.

## Structure du code

```
server/
  index.js            démarrage
  app.js              Express : sécurité (CSP, anti-CSRF), webhook Stripe, fichiers statiques
  config.js           variables d’environnement
  db.js               schéma SQLite + migrations
  auth.js             mots de passe (scrypt), sessions par cookie httpOnly, limiteur de débit
  routes/api.js       API REST (catalogue, notes, commentaires, recherche, abonnement, admin)
  services/           catalogue (fusion des sources), requêtes, recommandations, facturation
  providers/          connecteurs TVmaze, TMDB, OMDb
  sync/sync.js        mise à jour automatique + import à la demande
  data/seed.json      catalogue de départ
public/               application (HTML/CSS/JS sans étape de build), manifeste PWA, service worker, icônes
test/                 tests (node --test) : API, synchronisation simulée, paiement Stripe
```

## Tests

```bash
npm test
```

## Pistes pour la suite

Réinitialisation du mot de passe par e-mail, signalement/modération des commentaires, listes « à voir »,
notifications de nouveaux épisodes, passage à PostgreSQL si le trafic devient important.
