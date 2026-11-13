// Normalisation des genres en français, quelle que soit la source.

// Identifiants de genres TMDB (films et séries) → genres canoniques.
const TMDB_GENRES = {
  28: ['Action'],
  12: ['Aventure'],
  16: ['Animation'],
  35: ['Comédie'],
  80: ['Crime'],
  99: ['Documentaire'],
  18: ['Drame'],
  10751: ['Famille'],
  14: ['Fantastique'],
  36: ['Histoire'],
  27: ['Horreur'],
  10402: ['Musique'],
  9648: ['Mystère'],
  10749: ['Romance'],
  878: ['Science-fiction'],
  10770: ['Téléfilm'],
  53: ['Thriller'],
  10752: ['Guerre'],
  37: ['Western'],
  10759: ['Action', 'Aventure'],
  10762: ['Jeunesse'],
  10763: ['Actualités'],
  10764: ['Téléréalité'],
  10765: ['Science-fiction', 'Fantastique'],
  10766: ['Feuilleton'],
  10767: ['Talk-show'],
  10768: ['Guerre', 'Politique'],
};

// Genres TVmaze (en anglais) → genres canoniques.
const TVMAZE_GENRES = {
  Action: 'Action',
  Adult: 'Adulte',
  Adventure: 'Aventure',
  Anime: 'Animation',
  Children: 'Jeunesse',
  Comedy: 'Comédie',
  Crime: 'Crime',
  DIY: 'Loisirs',
  Drama: 'Drame',
  Espionage: 'Espionnage',
  Family: 'Famille',
  Fantasy: 'Fantastique',
  Food: 'Cuisine',
  History: 'Histoire',
  Horror: 'Horreur',
  Legal: 'Judiciaire',
  Medical: 'Médical',
  Music: 'Musique',
  Mystery: 'Mystère',
  Nature: 'Nature',
  Romance: 'Romance',
  'Science-Fiction': 'Science-fiction',
  Sports: 'Sport',
  Supernatural: 'Surnaturel',
  Thriller: 'Thriller',
  Travel: 'Voyage',
  War: 'Guerre',
  Western: 'Western',
};

export function genresFromTmdbIds(ids = []) {
  return unique(ids.flatMap((id) => TMDB_GENRES[id] || []));
}

export function genresFromTvmaze(names = []) {
  return unique(names.map((n) => TVMAZE_GENRES[n] || n));
}

export function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}
