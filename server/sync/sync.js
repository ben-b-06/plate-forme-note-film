// Mise à jour régulière de la base : nouveautés, tendances, épisodes et notes des plateformes.
import { now, DAY, yearOf, normalizeText } from '../util.js';
import {
  saveBundle,
  markTitle,
  setLinks,
  setTitleRating,
  setEpisodeRating,
  resolveDuplicates,
  upsertTitle,
} from '../services/catalog.js';
import { mapTvmazeShow, mapTvmazeSearchResult } from '../providers/tvmaze.js';
import { mapTmdbListItem, mapTmdbDetails, mapTmdbSeason, mapTmdbSearchResult } from '../providers/tmdb.js';
import { mapOmdbRatings, mapOmdbSeason } from '../providers/omdb.js';

const CHECK_EVERY_MS = 15 * 60 * 1000;

export function createSync({ db, config, providers, log = console }) {
  const { tvmaze, tmdb, omdb } = providers;
  const cfg = config.sync;
  let current = null;
  let timer = null;

  // Une exécution interrompue (redémarrage) ne doit pas rester « en cours ».
  db.run(`UPDATE sync_runs SET status = 'interrompue', finished_at = ? WHERE status = 'running'`, now());

  // ---------- TMDB ----------

  async function tmdbResolveImdb(stats) {
    const rows = db.all(
      `SELECT id, type, imdb_id FROM titles WHERE imdb_id IS NOT NULL AND tmdb_id IS NULL
         AND (details_synced_at IS NULL OR details_synced_at < ?)
       ORDER BY popularity DESC LIMIT ?`,
      now() - cfg.staleDays * 4 * DAY,
      cfg.maxDetailsPerRun,
    );
    for (const t of rows) {
      const res = await tmdb.find(t.imdb_id);
      const hit = (t.type === 'movie' ? res?.movie_results : res?.tv_results)?.[0];
      if (!hit) {
        markTitle(db, t.id, { details_synced_at: now() });
        continue;
      }
      const id = resolveDuplicates(db, t.id, { type: t.type, tmdb_id: hit.id });
      markTitle(db, id, { tmdb_id: hit.id, details_synced_at: null });
      stats.matched++;
    }
  }

  async function tmdbDiscover(stats) {
    for (const kind of ['movie', 'tv']) {
      const type = kind === 'movie' ? 'movie' : 'series';
      const ranked = [];
      for (let page = 1; page <= cfg.tmdbPages; page++) {
        const data = await tmdb.trending(kind, page);
        for (const item of data?.results || []) {
          const m = mapTmdbListItem(item, kind);
          if (!m) continue;
          const isNew = !db.get('SELECT 1 FROM titles WHERE type = ? AND tmdb_id = ?', type, item.id);
          const id = saveBundle(db, m, { authoritative: true, source: 'tmdb' });
          if (isNew) stats.imported++;
          ranked.push(id);
        }
      }
      const popular = await tmdb.popular(kind, 1);
      for (const item of popular?.results || []) {
        const m = mapTmdbListItem(item, kind);
        if (!m) continue;
        const isNew = !db.get('SELECT 1 FROM titles WHERE type = ? AND tmdb_id = ?', type, item.id);
        saveBundle(db, m, { authoritative: true, source: 'tmdb' });
        if (isNew) stats.imported++;
      }
      if (ranked.length) {
        db.tx(() => {
          db.run('UPDATE titles SET trending_rank = NULL, trending_at = NULL WHERE type = ?', type);
          const t = now();
          ranked.forEach((id, i) => markTitle(db, id, { trending_rank: i + 1, trending_at: t }));
        });
      }
    }
  }

  async function tmdbFetchDetails(titleId, { fullSeasons, details }) {
    const t = db.get('SELECT * FROM titles WHERE id = ?', titleId);
    const kind = t.type === 'movie' ? 'movie' : 'tv';
    const d = details || (await tmdb.details(kind, t.tmdb_id));
    if (!d) {
      markTitle(db, t.id, { details_synced_at: now() });
      return { id: t.id, episodes: 0 };
    }
    const m = mapTmdbDetails(d, kind);
    const id = resolveDuplicates(db, t.id, m.title);
    saveBundle(db, { title: m.title, rating: m.rating, seasons: m.seasons }, { authoritative: true, source: 'tmdb' });

    const related = m.recommendations.map((r) => saveBundle(db, r, { authoritative: false, source: 'tmdb' }));
    setLinks(db, id, related, 'tmdb');

    let episodes = 0;
    if (kind === 'tv' && m.seasons.length) {
      // Premier passage : toutes les saisons ; ensuite seulement les deux dernières.
      const numbers = m.seasons.map((s) => s.season_number).sort((a, b) => a - b);
      const wanted = (fullSeasons ? numbers : numbers.slice(-2)).slice(-cfg.maxSeasonsPerSeries);
      for (const n of wanted) {
        const s = await tmdb.season(t.tmdb_id, n);
        const eps = s ? mapTmdbSeason(s) : [];
        saveBundle(db, { title: { ...m.title }, episodes: eps }, { authoritative: true, source: 'tmdb' });
        episodes += eps.length;
      }
    }
    markTitle(db, id, { details_synced_at: now() });
    return { id, episodes, related: related.length };
  }

  async function tmdbDetails(stats) {
    const rows = db.all(
      `SELECT id, details_synced_at FROM titles WHERE tmdb_id IS NOT NULL
         AND (details_synced_at IS NULL OR details_synced_at < ?)
       ORDER BY (details_synced_at IS NULL) DESC, trending_rank ASC NULLS LAST, popularity DESC LIMIT ?`,
      now() - cfg.staleDays * DAY,
      cfg.maxDetailsPerRun,
    );
    for (const r of rows) {
      if (!db.get('SELECT 1 FROM titles WHERE id = ?', r.id)) continue; // fusionné entre-temps
      const res = await tmdbFetchDetails(r.id, { fullSeasons: r.details_synced_at == null });
      stats.updated++;
      stats.episodes += res.episodes;
    }
  }

  // ---------- TVmaze ----------

  function plausible(local, show) {
    if (!local.year) return true;
    const y = yearOf(show.premiered);
    if (!y || Math.abs(y - local.year) <= 1) return true;
    const a = normalizeText(local.title);
    const b = normalizeText(show.name);
    return a === b || a.includes(b) || b.includes(a);
  }

  async function tvmazeSaveShow(localId, showId) {
    const show = await tvmaze.show(showId);
    if (!show) return null;
    const bundle = mapTvmazeShow(show);
    let id = localId;
    if (id) id = resolveDuplicates(db, id, bundle.title);
    // TMDB (en français) reste prioritaire pour les textes ; TVmaze complète.
    id = saveBundle(db, bundle, { authoritative: false, source: 'tvmaze' });
    if (show.weight != null) {
      const cur = db.get('SELECT source FROM titles WHERE id = ?', id);
      if (cur.source === 'tvmaze') markTitle(db, id, { popularity: show.weight });
    }
    markTitle(db, id, { tvmaze_synced_at: now() });
    return { id, episodes: bundle.episodes.length };
  }

  async function tvmazeSync(stats) {
    let budget = cfg.tvmazeMaxPerRun;

    // a) Séries connues par leur identifiant IMDb, pas encore reliées à TVmaze.
    const unlinked = db.all(
      `SELECT id, title, year, imdb_id FROM titles WHERE type = 'series' AND imdb_id IS NOT NULL
         AND tvmaze_id IS NULL AND (tvmaze_synced_at IS NULL OR tvmaze_synced_at < ?)
       ORDER BY popularity DESC LIMIT ?`,
      now() - cfg.staleDays * 4 * DAY,
      budget,
    );
    for (const t of unlinked) {
      budget--;
      const show = await tvmaze.lookupImdb(t.imdb_id);
      if (!show || !plausible(t, show)) {
        markTitle(db, t.id, { tvmaze_synced_at: now() });
        if (show) stats.warnings.push(`TVmaze : correspondance douteuse ignorée pour « ${t.title} »`);
        continue;
      }
      const res = await tvmazeSaveShow(t.id, show.id);
      if (res) {
        stats.matched++;
        stats.episodes += res.episodes;
        budget--;
      }
      if (budget <= 0) return;
    }

    // b) Rafraîchissement : séries mises à jour récemment chez TVmaze, puis les plus anciennes.
    let updatedIds = new Set();
    try {
      updatedIds = new Set(Object.keys(await tvmaze.updates('week')).map(Number));
    } catch (err) {
      stats.warnings.push(`TVmaze updates : ${err.message}`);
    }
    budget--;
    const linked = db.all(
      `SELECT id, tvmaze_id, tvmaze_synced_at FROM titles WHERE type = 'series' AND tvmaze_id IS NOT NULL
       ORDER BY tvmaze_synced_at ASC NULLS FIRST`,
    );
    const due = linked
      .filter(
        (t) =>
          t.tvmaze_synced_at == null ||
          t.tvmaze_synced_at < now() - cfg.staleDays * DAY ||
          (updatedIds.has(t.tvmaze_id) && t.tvmaze_synced_at < now() - DAY / 4),
      )
      .slice(0, Math.max(0, budget));
    for (const t of due) {
      if (!db.get('SELECT 1 FROM titles WHERE id = ?', t.id)) continue;
      const res = await tvmazeSaveShow(t.id, t.tvmaze_id);
      budget--;
      if (res) {
        stats.updated++;
        stats.episodes += res.episodes;
      }
    }

    // c) Découverte : séries diffusées aujourd'hui (pays configurés + plateformes web).
    let discover = Math.min(cfg.tvmazeDiscoverPerRun, Math.max(0, budget));
    if (discover <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Map();
    const lists = [];
    for (const c of cfg.tvmazeCountries) lists.push(await tvmaze.schedule(c, today));
    lists.push(await tvmaze.webSchedule(today));
    for (const list of lists) {
      for (const ep of list || []) {
        const show = ep.show || ep._embedded?.show;
        if (show && !seen.has(show.id)) seen.set(show.id, show);
      }
    }
    const candidates = [...seen.values()]
      .filter((s) => (s.weight ?? 0) >= 60 && s.type !== 'News' && s.type !== 'Talk Show')
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    for (const s of candidates) {
      if (discover <= 0) break;
      const exists = db.get(
        'SELECT id FROM titles WHERE tvmaze_id = ? OR (imdb_id IS NOT NULL AND imdb_id = ?)',
        s.id,
        s.externals?.imdb ?? null,
      );
      if (exists) continue;
      const res = await tvmazeSaveShow(null, s.id);
      discover--;
      if (res) {
        stats.imported++;
        stats.episodes += res.episodes;
      }
    }
  }

  // ---------- OMDb ----------

  async function omdbSync(stats) {
    let budget = cfg.omdbMaxPerRun;
    const rows = db.all(
      `SELECT id, type, imdb_id, poster_url FROM titles WHERE imdb_id IS NOT NULL
         AND (omdb_synced_at IS NULL OR omdb_synced_at < ?)
       ORDER BY (omdb_synced_at IS NULL) DESC, trending_rank ASC NULLS LAST, popularity DESC LIMIT ?`,
      now() - cfg.staleDays * 2 * DAY,
      budget,
    );
    for (const t of rows) {
      if (budget <= 0) break;
      const data = await omdb.byImdb(t.imdb_id);
      budget--;
      if (data) {
        const ratings = mapOmdbRatings(data);
        for (const [source, r] of Object.entries(ratings)) {
          setTitleRating(db, t.id, source, r);
          stats.ratings++;
        }
        if (!t.poster_url && data.Poster && data.Poster !== 'N/A') {
          upsertTitle(db, { type: t.type, imdb_id: t.imdb_id, poster_url: data.Poster, poster_large_url: data.Poster });
        }
        if (t.type === 'series') {
          const seasons = db
            .all('SELECT DISTINCT season_number AS n FROM episodes WHERE title_id = ? AND season_number > 0 ORDER BY n DESC', t.id)
            .map((r) => r.n)
            .slice(0, 6);
          for (const n of seasons) {
            if (budget <= 0) break;
            const s = await omdb.season(t.imdb_id, n);
            budget--;
            for (const e of mapOmdbSeason(s)) {
              const ep = db.get(
                'SELECT id FROM episodes WHERE title_id = ? AND season_number = ? AND episode_number = ?',
                t.id,
                n,
                e.episode_number,
              );
              if (!ep) continue;
              if (e.imdb_id) db.run('UPDATE episodes SET imdb_id = COALESCE(imdb_id, ?) WHERE id = ?', e.imdb_id, ep.id);
              if (e.rating) {
                setEpisodeRating(db, ep.id, 'imdb', e.rating);
                stats.ratings++;
              }
            }
          }
        }
      }
      markTitle(db, t.id, { omdb_synced_at: now() });
    }
  }

  // ---------- Orchestration ----------

  async function step(name, fn, stats) {
    const t0 = Date.now();
    try {
      await fn(stats);
      stats.steps[name] = { ok: true, ms: Date.now() - t0 };
    } catch (err) {
      log.error?.(`[sync] ${name} : ${err.message}`);
      stats.steps[name] = { ok: false, ms: Date.now() - t0, error: err.message };
      stats.errors.push(`${name} : ${err.message}`);
    }
  }

  async function execute(runId) {
    const stats = { imported: 0, updated: 0, matched: 0, episodes: 0, ratings: 0, steps: {}, errors: [], warnings: [] };
    if (tmdb) {
      await step('tmdb:correspondances', tmdbResolveImdb, stats);
      await step('tmdb:tendances', tmdbDiscover, stats);
      await step('tmdb:details', tmdbDetails, stats);
    }
    if (tvmaze) await step('tvmaze', tvmazeSync, stats);
    if (omdb) await step('omdb', omdbSync, stats);
    const attempted = Object.keys(stats.steps).length;
    const failed = Object.values(stats.steps).filter((s) => !s.ok).length;
    const status = attempted === 0 ? 'ignorée' : failed === 0 ? 'ok' : failed === attempted ? 'erreur' : 'partielle';
    db.run(
      'UPDATE sync_runs SET status = ?, finished_at = ?, stats = ?, error = ? WHERE id = ?',
      status,
      now(),
      JSON.stringify(stats),
      stats.errors.join('\n') || null,
      runId,
    );
    log.info?.(
      `[sync] ${status} — ${stats.imported} nouveaux, ${stats.updated} mis à jour, ${stats.episodes} épisodes, ${stats.ratings} notes`,
    );
    return { id: runId, status, stats };
  }

  async function run(reason = 'manuel') {
    if (current) return { skipped: true, id: current.id };
    const id = db.run(`INSERT INTO sync_runs (reason, status, started_at) VALUES (?, 'running', ?)`, reason, now())
      .lastInsertRowid;
    current = { id, promise: execute(id) };
    try {
      return await current.promise;
    } catch (err) {
      db.run(`UPDATE sync_runs SET status = 'erreur', finished_at = ?, error = ? WHERE id = ?`, now(), err.message, id);
      throw err;
    } finally {
      current = null;
    }
  }

  function lastFinished() {
    return db.get(`SELECT MAX(started_at) AS t FROM sync_runs WHERE status IN ('ok', 'partielle', 'erreur', 'ignorée')`)?.t || 0;
  }

  function isDue() {
    return now() - lastFinished() >= cfg.intervalHours * 3600 * 1000;
  }

  function start() {
    if (!cfg.enabled || timer) return;
    const tick = () => {
      if (isDue()) run('planifiée').catch((err) => log.error?.(`[sync] ${err.message}`));
    };
    if (cfg.onStart) setTimeout(tick, cfg.startDelaySeconds * 1000).unref?.();
    timer = setInterval(tick, Math.min(CHECK_EVERY_MS, cfg.intervalHours * 3600 * 1000));
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function status() {
    const runs = db.all('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 15').map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      stats: r.stats ? JSON.parse(r.stats) : null,
      error: r.error,
    }));
    const last = lastFinished();
    return {
      running: Boolean(current),
      enabled: cfg.enabled,
      intervalHours: cfg.intervalHours,
      lastRunAt: last || null,
      nextRunAt: cfg.enabled ? (last ? last + cfg.intervalHours * 3600 * 1000 : null) : null,
      providers: { tmdb: Boolean(tmdb), tvmaze: Boolean(tvmaze), omdb: Boolean(omdb) },
      runs,
    };
  }

  // ---------- Recherche distante & import à la demande ----------

  async function searchRemote(q) {
    const out = [];
    const tasks = [];
    if (tmdb) {
      tasks.push(
        tmdb.search(q).then((d) => (d?.results || []).map(mapTmdbSearchResult).filter(Boolean).slice(0, 10)),
      );
    }
    if (tvmaze) tasks.push(tvmaze.search(q).then((list) => list.map(mapTvmazeSearchResult).slice(0, 8)));
    const settled = await Promise.allSettled(tasks);
    for (const s of settled) if (s.status === 'fulfilled') out.push(...s.value);
    // Retire ce qui est déjà dans le catalogue.
    return out.filter((r) => {
      if (r.provider === 'tmdb') return !db.get('SELECT 1 FROM titles WHERE type = ? AND tmdb_id = ?', r.type, r.providerId);
      return !db.get(
        'SELECT 1 FROM titles WHERE tvmaze_id = ? OR (imdb_id IS NOT NULL AND imdb_id = ?)',
        r.providerId,
        r.imdbId ?? null,
      );
    });
  }

  async function importTitle(provider, providerId, type) {
    if (provider === 'tvmaze' && tvmaze) {
      const res = await tvmazeSaveShow(null, providerId);
      if (!res) return null;
      return res.id;
    }
    if (provider === 'tmdb' && tmdb) {
      const kind = type === 'movie' ? 'movie' : 'tv';
      const details = await tmdb.details(kind, providerId);
      if (!details) return null;
      const m = mapTmdbDetails(details, kind);
      const id = saveBundle(db, { title: m.title, rating: m.rating }, { authoritative: true, source: 'tmdb' });
      const res = await tmdbFetchDetails(id, { fullSeasons: true, details });
      return res.id;
    }
    return null;
  }

  return { run, start, stop, status, isDue, searchRemote, importTitle };
}
