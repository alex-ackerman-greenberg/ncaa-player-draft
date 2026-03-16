/**
 * NCAA March Madness Player Points Tracker
 * 7 entries, each with a roster; points aggregated from ESPN box scores.
 * Optional: require Google sign-in by setting GOOGLE_CLIENT_ID in config.js.
 */

const GOOGLE_CLIENT_ID = (typeof window !== 'undefined' && window.GOOGLE_CLIENT_ID) || '';
const AUTH_STORAGE_KEY = 'ncaa-draft-auth';
const SKIPPED_AUTH_KEY = 'ncaa-draft-skipped-auth';

function getAuthUser() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

function setAuthUser(user) {
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch (_) {}
}

function clearAuthUser() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (_) {}
}

function getSkippedAuth() {
  try {
    return sessionStorage.getItem(SKIPPED_AUTH_KEY) === '1';
  } catch (_) {}
  return false;
}

function setSkippedAuth(skip) {
  try {
    if (skip) sessionStorage.setItem(SKIPPED_AUTH_KEY, '1');
    else sessionStorage.removeItem(SKIPPED_AUTH_KEY);
  } catch (_) {}
}

function showAuthGate(show) {
  const gate = document.getElementById('auth-gate');
  const appWrap = document.getElementById('app-wrap');
  if (gate) gate.hidden = !show;
  if (appWrap) appWrap.hidden = show;
}

function renderAuthHeader(user) {
  const el = document.getElementById('auth-user');
  const signInBtn = document.getElementById('sign-in-btn');
  const signOutBtn = document.getElementById('sign-out-btn');
  if (el) {
    el.textContent = user && user.email ? 'Signed in as ' + user.email : '';
    el.hidden = !(user && user.email);
  }
  if (signInBtn) signInBtn.hidden = !!(user && user.email) || !GOOGLE_CLIENT_ID;
  if (signOutBtn) signOutBtn.hidden = !(user && user.email);
}

const GSI_RETRY_MAX = 25; // ~5 seconds at 200ms
let gsiRetryCount = 0;

function initGoogleSignIn() {
  const el = document.getElementById('google-signin-btn');
  if (!el || !GOOGLE_CLIENT_ID) return;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
    gsiRetryCount += 1;
    if (gsiRetryCount >= GSI_RETRY_MAX) {
      el.innerHTML = '<span class="auth-btn-error">Google sign-in couldn’t load (check Authorized JavaScript origins in Google Cloud Console). You can continue without signing in below.</span>';
      return;
    }
    el.innerHTML = '<span class="auth-btn-loading">Loading sign-in button…</span>';
    setTimeout(initGoogleSignIn, 200);
    return;
  }
  gsiRetryCount = 0;
  el.innerHTML = '';
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (res) => {
        if (!res || !res.credential) return;
        try {
          const payload = JSON.parse(atob(res.credential.split('.')[1]));
          const user = { email: payload.email || '', name: payload.name || '' };
          setAuthUser(user);
          showAuthGate(false);
          renderAuthHeader(user);
          runAppInit();
        } catch (_) {}
      },
      auto_select: false,
    });
    google.accounts.id.renderButton(el, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
    });
  } catch (_) {
    el.innerHTML = '<span class="auth-btn-error">Sign-in could not load. Check Authorized JavaScript origins in Google Cloud Console. You can continue without signing in below.</span>';
  }
}

function runAppInit() {
  const nav = document.getElementById('app-nav');
  const main = document.getElementById('app-main');
  if (!nav || !main) return;
  if (!nav.querySelector('a[href="#leaderboard"]') || !nav.querySelector('a[href="#draft"]')) {
    nav.innerHTML = NAV_HTML;
  }
  if (!main.querySelector('#standings-view')) {
    main.innerHTML = `
      <div id="standings-view" data-view="leaderboard"></div>
      <div id="rosters-view" data-view="teams" hidden></div>
      <div id="pool-view" data-view="pool" hidden></div>
      <div id="draft-view" data-view="draft" hidden></div>
      <div id="bracket-view" data-view="bracket" hidden></div>
    `;
  }
  if (!main.querySelector('#draft-view')) {
    const bracket = main.querySelector('#bracket-view');
    const draftEl = document.createElement('div');
    draftEl.id = 'draft-view';
    draftEl.setAttribute('data-view', 'draft');
    draftEl.hidden = true;
    if (bracket) main.insertBefore(draftEl, bracket);
    else main.appendChild(draftEl);
  }
  window.addEventListener('hashchange', route);
  route();
  startAutoRefresh();
  document.getElementById('sign-in-btn')?.addEventListener('click', () => {
    setSkippedAuth(false);
    showAuthGateAndListenForSkip();
  });
  document.getElementById('sign-out-btn')?.addEventListener('click', () => {
    clearAuthUser();
    setSkippedAuth(false);
    renderAuthHeader(null);
    showAuthGateAndListenForSkip();
  });
}

const ESPN = {
  base: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball',
  scoreboard() {
    return fetch(`${this.base}/scoreboard`).then(r => r.json());
  },
  /** Postseason/tournament scoreboard (seasontype=3). */
  scoreboardTournament() {
    return fetch(`${this.base}/scoreboard?seasontype=3`).then(r => r.json());
  },
  scoreboardForDate(date) {
    return fetch(`${this.base}/scoreboard?dates=${date}`).then(r => r.json());
  },
  summary(gameId) {
    return fetch(`${this.base}/summary?event=${gameId}`).then(r => r.json());
  },
  rankings() {
    return fetch(`${this.base}/rankings`).then(r => r.json());
  },
  teamRoster(teamId, season) {
    const url = season ? `${this.base}/teams/${teamId}/roster?season=${season}` : `${this.base}/teams/${teamId}/roster`;
    return fetch(url).then(r => r.json());
  },
  /** Statistics API (site) — often returns "Failed to retrieve league stats"; use core leaders instead. */
  statistics() {
    return fetch(`${this.base}/statistics`).then(r => r.json());
  },
};

/** ESPN Web API: top scorers by PPG (byathlete, sorted by offensive.avgPoints desc). */
const ESPN_BYATHLETE = {
  base: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball/statistics/byathlete',
  /** Top qualified players by PPG; conference=50 (e.g. D1). Supports pagination. */
  topScorersUrl(limit = 50, page = 1) {
    const params = new URLSearchParams({
      region: 'us',
      lang: 'en',
      contentorigin: 'espn',
      isqualified: 'true',
      page: String(page),
      limit: String(limit),
      sort: 'offensive.avgPoints:desc',
      conference: '50',
    });
    return `${this.base}?${params}`;
  },
  fetchTopScorers(limit, page) {
    return fetch(this.topScorersUrl(limit, page)).then(r => r.json());
  },
};

const POINTS_KEY = 'points'; // stats index in box score
const STORAGE_KEYS = {
  entries: 'ncaa-draft-entries',
  assignments: 'ncaa-draft-assignments',
  pool: 'ncaa-draft-pool',
  playerPointsCache: 'ncaa-draft-player-points-cache',
  seasonPpgCache: 'ncaa-draft-season-ppg-cache',
  draftSlotOrder: 'ncaa-draft-slot-order',
  draftSelections: 'ncaa-draft-selections',
};

const DEFAULT_ENTRY_NAMES = Array.from({ length: 7 }, (_, i) => `Entry ${i + 1}`);

function getEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.entries);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 7) return parsed;
    }
  } catch (_) {}
  return DEFAULT_ENTRY_NAMES.map((name, i) => ({ id: `entry-${i}`, name, playerIds: [] }));
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
}

function getAssignments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.assignments);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function saveAssignments(assignments) {
  localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(assignments));
}

function getPool() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pool);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function savePool(pool) {
  localStorage.setItem(STORAGE_KEYS.pool, JSON.stringify(pool));
}

/** Draft slot order: slot 1 = first pick in round 1, slot 7 = last in round 1 / first in round 2 (snake). Array of 7 entry ids. */
function getDraftSlotOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.draftSlotOrder);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 7) return parsed;
    }
  } catch (_) {}
  const entries = getEntries();
  return entries.map(e => e.id);
}

function saveDraftSlotOrder(slotOrder) {
  if (!Array.isArray(slotOrder) || slotOrder.length !== 7) return;
  localStorage.setItem(STORAGE_KEYS.draftSlotOrder, JSON.stringify(slotOrder));
}

/** Draft selections: pick number (1-based) -> player id. Used to show past picks and exclude from future dropdowns. */
function getDraftSelections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.draftSelections);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function saveDraftSelections(selections) {
  localStorage.setItem(STORAGE_KEYS.draftSelections, JSON.stringify(selections));
}

function setDraftPick(pick, playerId) {
  const sel = getDraftSelections();
  if (playerId) sel[String(pick)] = playerId;
  else delete sel[String(pick)];
  saveDraftSelections(sel);
}

/** Snake draft: for pick number p (1-based), return { round, slot (1-7), entryId }. */
function getPickAtPosition(p, slotOrder) {
  const round = Math.ceil(p / 7);
  const posInRound = (p - 1) % 7;
  const slot = round % 2 === 1 ? posInRound + 1 : 7 - posInRound;
  const entryId = slotOrder[slot - 1];
  return { round, slot, entryId };
}

/** Generate full draft train for R rounds: array of { pick, round, slot, entryId }. */
function getDraftTrain(slotOrder, numRounds) {
  const out = [];
  for (let p = 1; p <= 7 * numRounds; p++) {
    const { round, slot, entryId } = getPickAtPosition(p, slotOrder);
    out.push({ pick: p, round, slot, entryId });
  }
  return out;
}

function addManualPlayer(displayName, teamName, espnPlayerId) {
  const pool = getPool();
  const id = (espnPlayerId && String(espnPlayerId).trim()) || 'm-' + Date.now();
  const name = (displayName && String(displayName).trim()) || 'Unknown';
  pool[id] = {
    id,
    displayName: name,
    teamName: teamName ? String(teamName).trim() : '',
    manual: !espnPlayerId || !String(espnPlayerId).trim(),
  };
  savePool(pool);
  return id;
}

function getPlayerPointsCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.playerPointsCache);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function savePlayerPointsCache(cache) {
  localStorage.setItem(STORAGE_KEYS.playerPointsCache, JSON.stringify(cache));
}

function parsePointsFromBoxScore(summary) {
  const out = {};
  const box = summary && summary.boxscore;
  if (!box || !box.players) return out;

  for (const teamPlayers of box.players) {
    const statBlock = teamPlayers.statistics && teamPlayers.statistics[0];
    if (!statBlock || !statBlock.athletes || !statBlock.keys) continue;
    const pointsIdx = statBlock.keys.indexOf('points');
    if (pointsIdx === -1) continue;

    for (const row of statBlock.athletes) {
      const id = row.athlete && row.athlete.id;
      const name = row.athlete && row.athlete.displayName;
      if (!id) continue;
      const pts = parseInt(row.stats && row.stats[pointsIdx], 10) || 0;
      out[id] = { name, points: pts };
    }
  }
  return out;
}

function extractPoolFromSummary(summary, pool) {
  const box = summary && summary.boxscore;
  if (!box || !box.players) return pool;

  for (const teamPlayers of box.players) {
    const statBlock = teamPlayers.statistics && teamPlayers.statistics[0];
    if (!statBlock || !statBlock.athletes) continue;
    const teamName = teamPlayers.team ? teamPlayers.team.displayName : '';

    for (const row of statBlock.athletes) {
      const a = row.athlete;
      if (!a || !a.id) continue;
      if (!pool[a.id]) {
        pool[a.id] = { id: a.id, displayName: a.displayName || a.shortName || 'Unknown', teamName };
      }
    }
  }
  return pool;
}

function computeByPlayerFromByGame(byGame) {
  const byPlayer = {};
  for (const gamePoints of Object.values(byGame)) {
    for (const [pid, data] of Object.entries(gamePoints)) {
      byPlayer[pid] = (byPlayer[pid] || 0) + (data.points || 0);
    }
  }
  return byPlayer;
}

async function fetchAllPlayerPoints(gameIds, onProgress) {
  const cache = getPlayerPointsCache();
  const byGame = { ...(cache.byGame || {}) };
  let updated = false;

  for (let i = 0; i < gameIds.length; i++) {
    const gid = gameIds[i];
    if (onProgress) onProgress(i + 1, gameIds.length, gid);

    try {
      const summary = await ESPN.summary(gid);
      const gamePoints = parsePointsFromBoxScore(summary);
      byGame[gid] = gamePoints;
      updated = true;
    } catch (e) {
      console.warn('Summary fetch failed for game', gid, e);
    }
  }

  const byPlayer = computeByPlayerFromByGame(byGame);
  if (updated) {
    savePlayerPointsCache({ byGame, byPlayer, updatedAt: Date.now() });
  }
  return byPlayer;
}

/**
 * Parse ID from ESPN $ref URL (e.g. ".../athletes/5322237?..." -> "5322237").
 */
function parseRefId(refObj, path) {
  const ref = refObj && refObj.$ref;
  if (!ref || typeof ref !== 'string') return null;
  const match = ref.match(new RegExp(path + '/(\\d+)'));
  return match ? match[1] : null;
}

/** ESPN CDN team logo for NCAA (500px asset; scale with CSS for list rows). */
function teamLogoUrl(teamId) {
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`;
}

/** Per-page limit for byathlete API (API may cap this; we paginate to get full list). */
const PPG_LEADERS_PAGE_SIZE = 50;

/**
 * Fetch full-season PPG leaders for current NCAA men's season.
 * Uses ESPN byathlete API (sorted by offensive.avgPoints desc). Fetches all pages so we get
 * the full leaderboard, not just the first page (e.g. 14–25 players).
 * Returns { leaders: [{ id, displayName, teamId, teamName, ppg, gamesPlayed }], byPlayer: {} }
 * and updates season PPG cache.
 */
async function fetchPpgLeaders() {
  const leaders = [];
  const byPlayer = {};
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let data;
    try {
      data = await ESPN_BYATHLETE.fetchTopScorers(PPG_LEADERS_PAGE_SIZE, page);
    } catch (e) {
      if (page === 1) throw new Error('Could not load leaders: ' + (e.message || 'network error'));
      break;
    }
    const athletes = data && data.athletes;
    if (!Array.isArray(athletes) || athletes.length === 0) {
      if (page === 1) throw new Error('No athletes in response.');
      break;
    }
    for (const item of athletes) {
      const a = item.athlete;
      if (!a || !a.id) continue;
      const id = String(a.id);
      if (byPlayer[id]) continue; // dedupe across pages
      const offensive = item.categories && item.categories.find(c => c.name === 'offensive');
      const general = item.categories && item.categories.find(c => c.name === 'general');
      const ppg = offensive && offensive.values && offensive.values[0] != null ? Number(offensive.values[0]) : 0;
      const gamesPlayed = general && general.values && general.values[0] != null ? Math.round(Number(general.values[0])) : 0;
      const teamName = [a.teamShortName, a.teamName].filter(Boolean).join(' ') || '';
      const teamId = a.teamId != null ? String(a.teamId) : undefined;
      leaders.push({
        id,
        displayName: a.displayName || a.shortName || 'Player ' + id,
        teamId,
        teamName,
        ppg,
        gamesPlayed,
      });
      byPlayer[id] = { ppg, gamesPlayed };
    }
    hasMore = athletes.length >= PPG_LEADERS_PAGE_SIZE;
    page += 1;
  }

  if (leaders.length === 0) throw new Error('No athletes in response.');
  saveSeasonPpgCache({ byPlayer, updatedAt: Date.now() });
  return { leaders, byPlayer };
}

/**
 * Fill pool with top scorers from current season (PPG leaders from ESPN stats).
 * Replaces pool entirely.
 */
async function refreshPoolFromTopScorers(onProgress) {
  if (onProgress) onProgress(0, 1, 'Fetching full-season PPG leaders...');
  const { leaders } = await fetchPpgLeaders();
  const pool = {};
  for (const p of leaders) {
    pool[p.id] = {
      id: p.id,
      displayName: p.displayName,
      teamName: p.teamName || '',
      teamId: p.teamId || undefined,
    };
  }
  savePool(pool);
  return pool;
}

/**
 * Fetch all tournament team IDs from ESPN's sports core API.
 * Returns a Set of team ID strings for all 68 NCAA tournament teams.
 * Falls back to Coaches Poll rankings if the tournament group isn't available yet.
 */
async function fetchTournamentTeamIds() {
  const set = new Set();
  const year = new Date().getFullYear();

  // ESPN sports core API: returns exactly the 68 tournament teams via group 100 (NCAA tournament)
  try {
    const data = await fetch(
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/${year}/types/3/groups/100/teams?limit=100`
    ).then(r => r.json());
    const items = data && data.items;
    if (Array.isArray(items) && items.length >= 8) {
      for (const item of items) {
        const ref = item && item.$ref;
        if (!ref) continue;
        const m = ref.match(/\/teams\/(\d+)/);
        if (m) set.add(m[1]);
      }
    }
  } catch (_) {}

  // Fall back to Coaches Poll rankings if tournament group isn't available yet
  if (set.size < 8) {
    try {
      const rankingsData = await ESPN.rankings();
      const ranking = rankingsData.rankings && rankingsData.rankings[0];
      if (ranking && ranking.ranks) {
        for (const r of ranking.ranks) {
          if (r.team && r.team.id) set.add(String(r.team.id));
        }
      }
    } catch (_) {}
  }

  return set;
}

/**
 * Load player pool with top scorers (by full-season PPG) from teams in the NCAA tournament field.
 * Discovers the tournament field from the actual bracket schedule (not the Coaches Poll),
 * so teams like BYU that are in the tournament but outside the top 25 are included.
 */
async function refreshPoolFromTournamentField(onProgress) {
  if (onProgress) onProgress(0, 2, 'Fetching tournament field...');
  const tournamentTeamIds = await fetchTournamentTeamIds();
  if (tournamentTeamIds.size === 0) {
    throw new Error('Could not load tournament field. Try again or use "Load all PPG leaders".');
  }

  if (onProgress) onProgress(1, 2, 'Fetching full-season PPG leaders...');
  const { leaders } = await fetchPpgLeaders();
  const pool = {};
  for (const p of leaders) {
    if (p.teamId && tournamentTeamIds.has(p.teamId)) {
      pool[p.id] = {
        id: p.id,
        displayName: p.displayName,
        teamName: p.teamName || '',
        teamId: p.teamId || undefined,
      };
    }
  }
  savePool(pool);
  return pool;
}

/**
 * Fetch tournament scoreboard and return Set of team IDs that have been eliminated (lost a game).
 * Before the tournament or if no events, returns empty Set.
 */
let eliminatedTeamIdsCache = null;
async function getEliminatedTeamIds() {
  if (eliminatedTeamIdsCache) return eliminatedTeamIdsCache;
  const set = new Set();
  try {
    const data = await ESPN.scoreboardTournament();
    const events = (data && data.events) || [];
    for (const ev of events) {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp || !ev.status?.type?.completed) continue;
      const competitors = comp.competitors || [];
      for (const c of competitors) {
        if (c.winner === false && c.team && c.team.id != null) {
          set.add(String(c.team.id));
        }
      }
    }
  } catch (_) {}
  eliminatedTeamIdsCache = set;
  return set;
}

function clearEliminatedTeamIdsCache() {
  eliminatedTeamIdsCache = null;
}

/** Count how many players on an entry's roster have a team still in the tournament (not eliminated). */
function countPlayersRemaining(playerIds, pool, eliminatedTeamIds) {
  if (!playerIds || !playerIds.length) return 0;
  let count = 0;
  for (const pid of playerIds) {
    const p = pool[pid];
    const teamId = p && p.teamId != null ? String(p.teamId) : null;
    if (!teamId) count += 1;
    else if (!eliminatedTeamIds.has(teamId)) count += 1;
  }
  return count;
}

function computeStandings(entries, assignments, byPlayerPoints) {
  return entries.map(entry => {
    const playerIds = entry.playerIds || [];
    let total = 0;
    for (const pid of playerIds) {
      total += byPlayerPoints[pid] || 0;
    }
    return { ...entry, totalPoints: total };
  }).sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
}

function assignPlayerToEntry(playerId, entryId, entries, assignments) {
  if (assignments[playerId]) {
    const prevEntry = entries.find(e => e.id === assignments[playerId]);
    if (prevEntry && prevEntry.playerIds) {
      prevEntry.playerIds = prevEntry.playerIds.filter(id => id !== playerId);
    }
  }
  assignments[playerId] = entryId;
  const entry = entries.find(e => e.id === entryId);
  if (entry) {
    if (!entry.playerIds) entry.playerIds = [];
    if (!entry.playerIds.includes(playerId)) entry.playerIds.push(playerId);
  }
  saveAssignments(assignments);
  saveEntries(entries);
}

function unassignPlayer(playerId, entries, assignments) {
  const entryId = assignments[playerId];
  if (entryId) {
    const entry = entries.find(e => e.id === entryId);
    if (entry && entry.playerIds) {
      entry.playerIds = entry.playerIds.filter(id => id !== playerId);
    }
    delete assignments[playerId];
    saveAssignments(assignments);
    saveEntries(entries);
  }
}

// --------------- UI ---------------

let refreshIntervalId = null;
const REFRESH_INTERVAL_MS = 60 * 1000;

function getByPlayerPoints() {
  const cache = getPlayerPointsCache();
  return cache.byPlayer || {};
}

function getSeasonPpgCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.seasonPpgCache);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function saveSeasonPpgCache(data) {
  localStorage.setItem(STORAGE_KEYS.seasonPpgCache, JSON.stringify(data));
}

/**
 * Fetch full-season PPG (2025-26 regular season) and update cache.
 * Returns map playerId -> { ppg, gamesPlayed }.
 */
async function fetchSeasonPpgFromApi() {
  const { byPlayer } = await fetchPpgLeaders();
  return byPlayer;
}

function getSeasonPpg() {
  const cache = getSeasonPpgCache();
  return cache.byPlayer || {};
}

function startAutoRefresh() {
  if (refreshIntervalId) return;
  refreshIntervalId = setInterval(async () => {
    try {
      clearEliminatedTeamIdsCache();
      const data = await ESPN.scoreboard();
      const events = data.events || [];
      const gameIds = events.map(e => e.id);
      if (gameIds.length > 0) await fetchAllPlayerPoints(gameIds);
      const bracketView = document.getElementById('bracket-view');
      if (bracketView && !bracketView.hidden) renderBracket();
      if (document.getElementById('standings-view') && !document.getElementById('standings-view').hidden) renderLeaderboard();
    } catch (_) {}
  }, REFRESH_INTERVAL_MS);
}

function ensureGameIdsInCache(scoreboardData, callback) {
  const events = (scoreboardData && scoreboardData.events) || [];
  const cache = getPlayerPointsCache();
  const byGame = cache.byGame || {};
  const toFetch = events.filter(e => !byGame[e.id]).map(e => e.id);
  if (toFetch.length === 0) {
    callback();
    return;
  }
  fetchAllPlayerPoints(toFetch, (current, total) => {
    const el = document.getElementById('refresh-status');
    if (el) el.textContent = `Updating scores ${current}/${total}...`;
  }).then(() => {
    const el = document.getElementById('refresh-status');
    if (el) el.textContent = '';
    callback();
  });
}

function formatPointsLastUpdated(updatedAt) {
  if (!updatedAt || typeof updatedAt !== 'number') return null;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function renderLeaderboard() {
  const entries = getEntries();
  const byPlayer = getByPlayerPoints();
  const pool = getPool();
  const cache = getPlayerPointsCache();
  const lastUpdatedStr = formatPointsLastUpdated(cache.updatedAt) || 'Never';
  const standings = computeStandings(entries, getAssignments(), byPlayer);
  let eliminated = new Set();
  try {
    eliminated = await getEliminatedTeamIds();
  } catch (_) {}
  const standingsWithRemaining = standings.map(e => ({
    ...e,
    playersRemaining: countPlayersRemaining(e.playerIds || [], pool, eliminated),
    rosterSize: (e.playerIds || []).length,
  }));

  const html = `
    <div class="standings-header">
      <h2>Leaderboard</h2>
      <p class="refresh-hint">Scores refresh every 60 seconds during the tournament. Eliminated teams cannot add more points.</p>
      <button type="button" id="refresh-now-btn" class="btn-primary">Refresh scores now</button>
      <p id="refresh-status" class="refresh-status"></p>
      <p class="points-last-updated">Points last updated: <strong>${escapeHtml(lastUpdatedStr)}</strong></p>
    </div>
    <div class="standings-card card">
      <ol class="standings-list">
        ${standingsWithRemaining.map((e, i) => `
          <li class="standings-row rank-${i + 1}">
            <span class="rank">${i + 1}</span>
            <span class="entry-name">${escapeHtml(e.name)}</span>
            <span class="total-points">${e.totalPoints || 0} <small>pts</small></span>
            <span class="players-remaining">${e.rosterSize ? e.playersRemaining + ' of ' + e.rosterSize + ' remaining' : '—'}</span>
          </li>
        `).join('')}
      </ol>
    </div>
    <p class="view-footer"><a href="#teams">Teams & rosters</a> · <a href="#pool">Player pool</a></p>
  `;

  const view = document.getElementById('standings-view');
  if (view) {
    view.innerHTML = html;
    view.querySelector('#refresh-now-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('refresh-now-btn');
      const statusEl = document.getElementById('refresh-status');
      if (btn.disabled) return;
      btn.disabled = true;
      statusEl.textContent = 'Refreshing…';
      statusEl.className = 'refresh-status';
      clearEliminatedTeamIdsCache();
      ESPN.scoreboard().then(data => {
        ensureGameIdsInCache(data, () => {
          statusEl.textContent = 'Updated.';
          statusEl.className = 'refresh-status status-success';
          setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'refresh-status'; }, 2000);
        });
      }).catch(() => {
        statusEl.textContent = 'Refresh failed.';
        statusEl.className = 'refresh-status status-error';
      }).finally(() => { btn.disabled = false; renderLeaderboard(); });
    });
  }
}

async function renderTeams() {
  const entries = getEntries();
  const assignments = getAssignments();
  const pool = getPool();
  const byPlayer = getByPlayerPoints();
  let eliminated = new Set();
  try {
    eliminated = await getEliminatedTeamIds();
  } catch (_) {}

  const assignedIds = new Set(Object.keys(assignments));
  const poolList = Object.values(pool).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  const html = `
    <div class="rosters-header">
      <h2>Teams & rosters</h2>
      <p>All 7 teams and their rosters. Assign players from the <a href="#pool">player pool</a> (each player can only be on one team). Players on eliminated tournament teams cannot add more points.</p>
    </div>
    <div class="entries-grid">
      ${entries.map(entry => {
        const rosterIds = entry.playerIds || [];
        const roster = rosterIds.map(pid => {
          const p = pool[pid] || { id: pid, displayName: `Player ${pid}` };
          const pts = byPlayer[pid] || 0;
          return { ...p, points: pts };
        });
        const totalPts = roster.reduce((s, p) => s + p.points, 0);
        const remaining = countPlayersRemaining(rosterIds, pool, eliminated);
        const rosterSize = rosterIds.length;
        return `
          <section class="entry-card" data-entry-id="${escapeHtml(entry.id)}">
            <h3 class="entry-name-row">
              <span class="entry-name-display" data-entry-id="${escapeHtml(entry.id)}" tabindex="0" role="button" title="Click to edit">${escapeHtml(entry.name)}</span>
              <input type="text" class="entry-name-edit" data-entry-id="${escapeHtml(entry.id)}" value="${escapeHtml(entry.name)}" maxlength="80" aria-label="Entry name" style="display:none" />
              <button type="button" class="btn-edit-name" data-entry-id="${escapeHtml(entry.id)}" title="Edit name">✎</button>
            </h3>
            <p class="entry-total">Total: <strong>${totalPts}</strong> pts</p>
            <p class="entry-remaining">Players remaining: <strong>${rosterSize ? remaining + ' of ' + rosterSize : '0'}</strong></p>
            <ul class="roster-list">
              ${roster.length ? roster.map(p => `
                <li>
                  ${escapeHtml(p.displayName)} <span class="pts">${p.points} pts</span>
                  <button type="button" class="btn-unassign" data-player-id="${p.id}" title="Remove from roster">×</button>
                </li>
              `).join('') : '<li class="empty">No players assigned</li>'}
            </ul>
            <div class="entry-actions">
              <label>Add player:
                <select class="add-player-select" data-entry-id="${escapeHtml(entry.id)}">
                  <option value="">-- Select --</option>
                  ${poolList.filter(p => !assignedIds.has(p.id)).map(p => `
                    <option value="${escapeHtml(p.id)}">${escapeHtml(p.displayName)}${p.teamName ? ' (' + escapeHtml(p.teamName) + ')' : ''}</option>
                  `).join('')}
                </select>
              </label>
            </div>
          </section>
        `;
      }).join('')}
    </div>
    <p class="view-footer"><a href="#leaderboard">Leaderboard</a> · <a href="#pool">Player pool</a></p>
  `;

  const view = document.getElementById('rosters-view');
  if (view) {
    view.innerHTML = html;
    view.querySelectorAll('.btn-unassign').forEach(btn => {
      btn.addEventListener('click', () => {
        unassignPlayer(btn.dataset.playerId, getEntries(), getAssignments());
        renderTeams();
        renderLeaderboard();
      });
    });
    view.querySelectorAll('.add-player-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const playerId = sel.value;
        const entryId = sel.dataset.entryId;
        if (!playerId || !entryId) return;
        assignPlayerToEntry(playerId, entryId, getEntries(), getAssignments());
        sel.value = '';
        renderTeams();
        renderLeaderboard();
      });
    });
    function startEditName(entryId) {
      const card = view.querySelector(`.entry-card[data-entry-id="${entryId}"]`);
      if (!card) return;
      const display = card.querySelector('.entry-name-display');
      const input = card.querySelector('.entry-name-edit');
      if (!display || !input) return;
      display.style.display = 'none';
      input.style.display = 'inline-block';
      input.value = (getEntries().find(e => e.id === entryId) || {}).name || '';
      input.focus();
      input.select();
      function commit() {
        const val = input.value.trim();
        if (val) {
          const entries = getEntries();
          const entry = entries.find(e => e.id === entryId);
          if (entry) {
            entry.name = val;
            saveEntries(entries);
            renderTeams();
            renderLeaderboard();
          }
        }
        input.style.display = 'none';
        display.style.display = '';
        input.removeEventListener('blur', commit);
        input.removeEventListener('keydown', onKey);
      }
      function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = (getEntries().find(x => x.id === entryId) || {}).name || ''; commit(); }
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', onKey);
    }
    view.querySelectorAll('.btn-edit-name').forEach(btn => {
      btn.addEventListener('click', () => startEditName(btn.dataset.entryId));
    });
    view.querySelectorAll('.entry-name-display').forEach(span => {
      span.addEventListener('click', () => startEditName(span.dataset.entryId));
      span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEditName(span.dataset.entryId); } });
    });
  }
}

function renderPool() {
  const pool = getPool();
  const assignments = getAssignments();
  const entries = getEntries();
  const seasonPpg = getSeasonPpg();
  const list = Object.values(pool).sort((a, b) => {
    const ppgA = (seasonPpg[a.id] && seasonPpg[a.id].ppg) || 0;
    const ppgB = (seasonPpg[b.id] && seasonPpg[b.id].ppg) || 0;
    if (ppgB !== ppgA) return ppgB - ppgA;
    return (a.displayName || '').localeCompare(b.displayName || '');
  });

  const html = `
    <div class="pool-header">
      <h2>Player pool</h2>
      <p>Top scorers from this <strong>NCAA men's season</strong> (points per game). Load the pool, then assign each player to one of your 7 entries. Data from <a href="https://www.espn.com/mens-college-basketball/stats/player/_/season/2026" target="_blank" rel="noopener">ESPN season stats</a>.</p>
      <section class="pool-load-top25 card">
        <h3>Load pool</h3>
        <p class="pool-desc">Load the top scorers (by PPG) for the current NCAA men's basketball season.</p>
        <button type="button" id="pool-top-scorers-btn" class="btn-primary">Load top scorers (this season)</button>
        <button type="button" id="pool-tournament-btn" class="btn-secondary">Load tournament field only</button>
        <button type="button" id="pool-season-stats-btn" class="btn-secondary">Refresh PPG data</button>
        <p id="pool-tournament-status" class="refresh-status"></p>
      </section>
      <section class="manual-entry card">
        <h3>Add player manually</h3>
        <form id="manual-player-form" class="manual-form">
          <label>Player name <input type="text" id="manual-name" required placeholder="e.g. John Smith" /></label>
          <label>Team <input type="text" id="manual-team" placeholder="e.g. Duke Blue Devils" /></label>
          <label>ESPN Player ID <input type="text" id="manual-espn-id" placeholder="Optional – from ESPN player URL" /></label>
          <p class="manual-hint">If you enter an ESPN Player ID, points will update from game data.</p>
          <button type="submit" class="btn-primary">Add to pool</button>
        </form>
        <p id="manual-add-status" class="refresh-status"></p>
      </section>
    </div>
    <p class="pool-count">${list.length} players in pool · Sorted by PPG · Assign each player to an entry</p>
    <ul class="pool-list pool-list-with-assign">
      ${list.length ? list.map(p => {
        const entryId = assignments[p.id];
        const isAssigned = !!entryId;
        const stat = seasonPpg[p.id];
        const avgPpg = stat && stat.ppg != null ? Number(stat.ppg).toFixed(1) : '—';
        const gamesStr = stat && stat.gamesPlayed > 0 ? stat.gamesPlayed + ' gp' : '';
        const options = entries.map(e => '<option value="' + escapeHtml(e.id) + '"' + (entryId === e.id ? ' selected' : '') + '>' + escapeHtml(e.name) + '</option>').join('');
        const logoHtml = p.teamId ? '<img class="pool-team-logo" src="' + escapeHtml(teamLogoUrl(p.teamId)) + '" alt="" loading="lazy" />' : '';
        const rowClass = 'pool-list-row' + (isAssigned ? ' pool-list-row-assigned' : '');
        return '<li class="' + rowClass + '">' + logoHtml + '<span class="pool-player-info">' + escapeHtml(p.displayName) + (p.teamName ? ' · ' + escapeHtml(p.teamName) : '') + '</span><span class="pool-ppg">' + avgPpg + ' <small>ppg</small>' + (gamesStr ? ' <small>(' + gamesStr + ')</small>' : '') + '</span><label class="pool-assign-label"><select class="pool-assign-select" data-player-id="' + escapeHtml(p.id) + '"><option value="">— Unassigned —</option>' + options + '</select></label></li>';
      }).join('') : '<li class="empty">Click "Load top scorers" above to load the top scorers from this NCAA men\'s season.</li>'}
    </ul>
    <p class="view-footer"><a href="#leaderboard">Leaderboard</a> · <a href="#teams">Teams & rosters</a></p>
  `;

  const view = document.getElementById('pool-view');
  if (view) {
    view.innerHTML = html;

    function setPoolLoading(loading, statusEl) {
      const btn1 = view.querySelector('#pool-top-scorers-btn');
      const btn2 = view.querySelector('#pool-tournament-btn');
      const btn3 = view.querySelector('#pool-season-stats-btn');
      [btn1, btn2, btn3].forEach(b => { if (b) b.disabled = loading; });
      if (statusEl) statusEl.className = 'refresh-status' + (loading ? '' : '');
    }
    function setPoolStatus(statusEl, text, isSuccess, isError) {
      statusEl.textContent = text;
      statusEl.className = 'refresh-status' + (isSuccess ? ' status-success' : '') + (isError ? ' status-error' : '');
    }

    view.querySelector('#pool-top-scorers-btn')?.addEventListener('click', () => {
      const statusEl = view.querySelector('#pool-tournament-status');
      setPoolLoading(true, statusEl);
      setPoolStatus(statusEl, 'Loading top scorers…', false, false);
      refreshPoolFromTopScorers((current, total, msg) => {
        statusEl.textContent = msg || `Loading ${current}/${total}…`;
      }).then(() => {
        setPoolStatus(statusEl, 'Loaded.', true, false);
        renderPool();
        renderTeams();
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'refresh-status'; }, 3000);
      }).catch(e => {
        setPoolStatus(statusEl, 'Error: ' + (e.message || 'Could not load.'), false, true);
      }).finally(() => setPoolLoading(false));
    });

    view.querySelector('#pool-tournament-btn')?.addEventListener('click', () => {
      const statusEl = view.querySelector('#pool-tournament-status');
      setPoolLoading(true, statusEl);
      setPoolStatus(statusEl, 'Loading tournament field…', false, false);
      refreshPoolFromTournamentField((current, total, msg) => {
        statusEl.textContent = msg || `Loading ${current}/${total}…`;
      }).then(() => {
        statusEl.textContent = 'Updating PPG…';
        return fetchSeasonPpgFromApi();
      }).then(() => {
        setPoolStatus(statusEl, 'Done.', true, false);
        renderPool();
        renderTeams();
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'refresh-status'; }, 3000);
      }).catch(e => {
        setPoolStatus(statusEl, 'Error: ' + (e.message || 'Could not load.'), false, true);
      }).finally(() => setPoolLoading(false));
    });

    view.querySelector('#pool-season-stats-btn')?.addEventListener('click', () => {
      const statusEl = view.querySelector('#pool-tournament-status');
      setPoolLoading(true, statusEl);
      setPoolStatus(statusEl, 'Fetching full-season PPG…', false, false);
      fetchSeasonPpgFromApi().then(() => {
        setPoolStatus(statusEl, 'Full-season PPG updated.', true, false);
        renderPool();
        setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'refresh-status'; }, 3000);
      }).catch(e => {
        setPoolStatus(statusEl, 'Error: ' + (e.message || 'Failed to load.'), false, true);
      }).finally(() => setPoolLoading(false));
    });

    view.querySelectorAll('.pool-assign-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const playerId = sel.dataset.playerId;
        const entryId = sel.value || null;
        const entries = getEntries();
        const assignments = getAssignments();
        if (entryId) {
          assignPlayerToEntry(playerId, entryId, entries, getAssignments());
        } else {
          unassignPlayer(playerId, entries, getAssignments());
        }
        renderPool();
        renderTeams();
        renderLeaderboard();
      });
    });

    view.querySelector('#manual-player-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = view.querySelector('#manual-name');
      const teamInput = view.querySelector('#manual-team');
      const espnInput = view.querySelector('#manual-espn-id');
      const name = nameInput && nameInput.value.trim();
      if (!name) return;
      addManualPlayer(name, teamInput?.value, espnInput?.value);
      const statusEl = view.querySelector('#manual-add-status');
      if (statusEl) { statusEl.textContent = 'Added.'; statusEl.className = 'refresh-status status-success'; }
      if (nameInput) nameInput.value = '';
      if (teamInput) teamInput.value = '';
      if (espnInput) espnInput.value = '';
      setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'refresh-status'; } }, 2000);
      renderPool();
      renderTeams();
    });

  }
}

/**
 * Parse tournament scoreboard into games grouped by date.
 * Each game: { date, dateLabel, name, competitors: [{ displayName, score, winner }], status }
 */
function parseTournamentEvents(data) {
  const events = (data && data.events) || [];
  const byDate = {};
  for (const ev of events) {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const competitors = (comp.competitors || [])
      .sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1))
      .map(c => ({
        displayName: (c.team && c.team.displayName) || c.team?.shortDisplayName || 'TBD',
        abbreviation: (c.team && c.team.abbreviation) || '',
        score: c.score != null ? String(c.score) : null,
        winner: c.winner === true,
      }));
    const status = ev.status?.type?.completed ? 'final' : (ev.status?.type?.state === 'in' ? 'live' : 'scheduled');
    const dateStr = (ev.date || '').slice(0, 10);
    const d = dateStr ? new Date(dateStr + 'Z') : null;
    const dateLabel = d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
    if (!byDate[dateLabel]) byDate[dateLabel] = [];
    byDate[dateLabel].push({
      date: dateStr,
      name: ev.name || (competitors[0]?.displayName + ' vs ' + (competitors[1]?.displayName || 'TBD')),
      competitors,
      status,
    });
  }
  return byDate;
}

/** Empty bracket shell: West/Midwest top, South/East bottom, Final Four last. */
function getBracketShellHtml() {
  const teamPair = '<span class="bracket-matchup-team">TBD</span><span class="bracket-matchup-team">TBD</span>';
  function regionBlock(region) {
    const r1 = Array.from({ length: 8 }, (_, i) => `<div class="bracket-matchup" style="grid-row:${i + 1}">${teamPair}</div>`).join('');
    const r2 = Array.from({ length: 4 }, (_, i) => `<div class="bracket-matchup" style="grid-row:${i * 2 + 1} / span 2">${teamPair}</div>`).join('');
    const r3 = Array.from({ length: 2 }, (_, i) => `<div class="bracket-matchup" style="grid-row:${i * 4 + 1} / span 4">${teamPair}</div>`).join('');
    const r4 = `<div class="bracket-matchup" style="grid-row:1 / span 8">${teamPair}</div>`;
    return `
      <div class="bracket-region">
        <h3 class="bracket-region-title">${region}</h3>
        <div class="bracket-region-grid">
          <div class="bracket-round-col">
            <div class="bracket-round-label">Round of 64</div>
            <div class="bracket-round-slots">${r1}</div>
          </div>
          <div class="bracket-round-col">
            <div class="bracket-round-label">Round of 32</div>
            <div class="bracket-round-slots">${r2}</div>
          </div>
          <div class="bracket-round-col">
            <div class="bracket-round-label">Sweet 16</div>
            <div class="bracket-round-slots">${r3}</div>
          </div>
          <div class="bracket-round-col">
            <div class="bracket-round-label">Elite 8</div>
            <div class="bracket-round-slots">${r4}</div>
          </div>
        </div>
      </div>
    `;
  }
  const topRow = `<div class="bracket-espn-row bracket-espn-row-top">${regionBlock('West')}${regionBlock('Midwest')}</div>`;
  const bottomRow = `<div class="bracket-espn-row bracket-espn-row-bottom">${regionBlock('South')}${regionBlock('East')}</div>`;
  const ffHtml = `
    <div class="bracket-ff">
      <h3 class="bracket-region-title">Final Four</h3>
      <div class="bracket-ff-semis">
        <div class="bracket-matchup bracket-matchup-ff">${teamPair}</div>
        <div class="bracket-matchup bracket-matchup-ff">${teamPair}</div>
      </div>
      <h3 class="bracket-region-title bracket-region-title-champ">Championship</h3>
      <div class="bracket-matchup bracket-matchup-champ">${teamPair}</div>
    </div>
  `;
  return `
    <div class="bracket-shell-callout" role="status">
      <span class="bracket-shell-callout-icon" aria-hidden="true">ℹ</span>
      <p class="bracket-shell-note">Field announced Selection Sunday. Bracket will fill when the tournament is released. <em>Scroll horizontally to see all regions.</em></p>
    </div>
    <div class="bracket-espn">
      ${topRow}
      ${bottomRow}
      ${ffHtml}
    </div>
  `;
}

function renderBracket() {
  const view = document.getElementById('bracket-view');
  if (!view) return;
  view.innerHTML = `
    <div class="bracket-header">
      <h2>NCAAM Bracket</h2>
      <p class="bracket-desc">Tournament matchups and results. Updates as games are played.</p>
      <button type="button" id="bracket-refresh-btn" class="btn-secondary">Refresh bracket</button>
      <p id="bracket-status" class="refresh-status"></p>
    </div>
    <div id="bracket-content">Loading bracket…</div>
    <p class="view-footer"><a href="#leaderboard">Leaderboard</a> · <a href="#teams">Teams</a> · <a href="#pool">Player pool</a></p>
  `;

  function fillBracket() {
    const content = document.getElementById('bracket-content');
    const statusEl = document.getElementById('bracket-status');
    if (statusEl) statusEl.textContent = '';
    ESPN.scoreboardTournament()
      .then(data => {
        const byDate = parseTournamentEvents(data);
        const dates = Object.keys(byDate);
        const now = new Date();
        const year = now.getFullYear();
        const march15 = new Date(year, 2, 15);
        let selectionSunday = new Date(march15);
        while (selectionSunday.getDay() !== 0) selectionSunday.setDate(selectionSunday.getDate() + 1);
        const beforeSelectionSunday = now < selectionSunday;
        const showShell = dates.length === 0 || beforeSelectionSunday;
        if (showShell) {
          content.innerHTML = getBracketShellHtml();
          return;
        }
        content.innerHTML = Object.keys(byDate)
          .sort((a, b) => {
            const gamesA = byDate[a];
            const gamesB = byDate[b];
            const dA = gamesA[0]?.date || '';
            const dB = gamesB[0]?.date || '';
            return dA.localeCompare(dB);
          })
          .map(dateLabel => {
            const games = byDate[dateLabel];
            const rows = games.map(g => {
              const [away, home] = g.competitors;
              const hasScore = away?.score != null || home?.score != null;
              const awayScore = away?.score ?? '–';
              const homeScore = home?.score ?? '–';
              const awayWin = away?.winner ? ' bracket-winner' : '';
              const homeWin = home?.winner ? ' bracket-winner' : '';
              const statusTag = g.status === 'live' ? ' <span class="bracket-live">LIVE</span>' : (g.status === 'final' ? ' <span class="bracket-final">Final</span>' : '');
              return `
                <div class="bracket-game">
                  <div class="bracket-matchup">
                    <div class="bracket-team${awayWin}">${escapeHtml(away?.displayName || 'TBD')}</div>
                    <div class="bracket-score">${hasScore ? awayScore + ' – ' + homeScore : 'vs'}</div>
                    <div class="bracket-team${homeWin}">${escapeHtml(home?.displayName || 'TBD')}</div>
                  </div>
                  ${statusTag}
                </div>
              `;
            }).join('');
            return `<section class="bracket-date-group"><h3>${escapeHtml(dateLabel)}</h3><div class="bracket-games">${rows}</div></section>`;
          })
          .join('');
      })
      .catch(() => {
        content.innerHTML = getBracketShellHtml() + `
          <div class="bracket-empty card" style="margin-top:1rem">
            <p>Could not load bracket. <button type="button" id="bracket-retry-btn" class="btn-secondary">Retry</button></p>
          </div>
        `;
        content.querySelector('#bracket-retry-btn')?.addEventListener('click', fillBracket);
      });
  }

  fillBracket();
  view.querySelector('#bracket-refresh-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('bracket-refresh-btn');
    const statusEl = document.getElementById('bracket-status');
    if (btn && statusEl && !btn.disabled) {
      btn.disabled = true;
      statusEl.textContent = 'Refreshing…';
      statusEl.className = 'refresh-status';
      clearEliminatedTeamIdsCache();
      fillBracket();
      setTimeout(() => {
        const s = document.getElementById('bracket-status');
        if (s) { s.textContent = ''; s.className = 'refresh-status'; }
        const b = document.getElementById('bracket-refresh-btn');
        if (b) b.disabled = false;
      }, 2000);
    }
  });
}

function renderDraft() {
  const view = document.getElementById('draft-view');
  if (!view) return;
  const entries = getEntries();
  const slotOrder = getDraftSlotOrder();
  const entryById = Object.fromEntries(entries.map(e => [e.id, e]));
  const pool = getPool();
  const poolList = Object.values(pool).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  const selections = getDraftSelections();
  const numRoundsDefault = 10;
  const [slot1, slot2, slot3, slot4, slot5, slot6, slot7] = slotOrder.map((id, i) => ({ slot: i + 1, entryId: id }));

  const slotOptions = (selectedId) => entries.map(e => `<option value="${escapeHtml(e.id)}"${e.id === selectedId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`).join('');

  const train = getDraftTrain(slotOrder, numRoundsDefault);
  const trainRows = train.map(({ pick, round, slot, entryId }) => {
    const entry = entryById[entryId];
    const teamName = entry ? entry.name : '—';
    const selectedPlayerId = selections[String(pick)];
    const draftedSoFar = new Set();
    for (let p = 1; p < pick; p++) {
      const pid = selections[String(p)];
      if (pid) draftedSoFar.add(pid);
    }
    const available = poolList.filter(p => !draftedSoFar.has(p.id));
    let selectionCell;
    if (selectedPlayerId) {
      const player = pool[selectedPlayerId] || { displayName: 'Unknown' };
      selectionCell = `<span class="draft-pick-selected">${escapeHtml(player.displayName)}</span> <button type="button" class="draft-pick-clear btn-secondary" data-pick="${pick}" title="Clear pick">Clear</button>`;
    } else {
      const options = '<option value="">— Select player —</option>' + available.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.displayName)}${p.teamName ? ' (' + escapeHtml(p.teamName) + ')' : ''}</option>`).join('');
      selectionCell = `<select class="draft-pick-select" data-pick="${pick}" data-entry-id="${escapeHtml(entryId)}">${options}</select>`;
    }
    return `<tr><td>${pick}</td><td>${round}</td><td>${slot}</td><td>${escapeHtml(teamName)}</td><td class="draft-selection-cell">${selectionCell}</td></tr>`;
  }).join('');

  view.innerHTML = `
    <div class="draft-header">
      <h2>Draft order</h2>
      <p>Snake draft: round 1 is 1→2→3→4→5→6→7, round 2 is 7→6→5→4→3→2→1, and so on. Set which team is in each draft slot below.</p>
    </div>
    <section class="draft-slots card">
      <h3>Draft slots (who picks when)</h3>
      <p class="draft-slots-desc">Slot 1 picks first in odd rounds and last in even rounds. Assign each team to a slot.</p>
      <div class="draft-slot-grid">
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 1</span>
          <select class="draft-slot-select" data-slot="1">${slotOptions(slot1.entryId)}</select>
        </label>
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 2</span>
          <select class="draft-slot-select" data-slot="2">${slotOptions(slot2.entryId)}</select>
        </label>
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 3</span>
          <select class="draft-slot-select" data-slot="3">${slotOptions(slot3.entryId)}</select>
        </label>
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 4</span>
          <select class="draft-slot-select" data-slot="4">${slotOptions(slot4.entryId)}</select>
        </label>
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 5</span>
          <select class="draft-slot-select" data-slot="5">${slotOptions(slot5.entryId)}</select>
        </label>
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 6</span>
          <select class="draft-slot-select" data-slot="6">${slotOptions(slot6.entryId)}</select>
        </label>
        <label class="draft-slot-row">
          <span class="draft-slot-num">Slot 7</span>
          <select class="draft-slot-select" data-slot="7">${slotOptions(slot7.entryId)}</select>
        </label>
      </div>
    </section>
    <section class="draft-train card">
      <h3>Draft train (snake)</h3>
      <p class="draft-train-desc">Pick order for ${numRoundsDefault} rounds. Past picks show the selected player; use the dropdown for future picks. Scroll to see all rounds.</p>
      <div class="draft-train-wrap">
        <table class="draft-train-table">
          <thead><tr><th>Pick</th><th>Round</th><th>Slot</th><th>Team</th><th>Selection</th></tr></thead>
          <tbody>${trainRows}</tbody>
        </table>
      </div>
    </section>
    <p class="view-footer"><a href="#leaderboard">Leaderboard</a> · <a href="#teams">Teams</a> · <a href="#pool">Player pool</a></p>
  `;

  view.querySelectorAll('.draft-slot-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const slot = parseInt(sel.dataset.slot, 10);
      const entryId = sel.value;
      const order = getDraftSlotOrder().slice();
      const prevEntry = order[slot - 1];
      const otherIndex = order.indexOf(entryId);
      if (otherIndex !== -1 && otherIndex !== slot - 1) {
        order[slot - 1] = entryId;
        order[otherIndex] = prevEntry;
      } else {
        order[slot - 1] = entryId;
      }
      saveDraftSlotOrder(order);
      renderDraft();
    });
  });

  view.querySelectorAll('.draft-pick-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const pick = parseInt(sel.dataset.pick, 10);
      const entryId = sel.dataset.entryId;
      const playerId = sel.value;
      if (!playerId) return;
      setDraftPick(pick, playerId);
      assignPlayerToEntry(playerId, entryId, getEntries(), getAssignments());
      renderDraft();
      renderTeams();
      renderLeaderboard();
    });
  });

  view.querySelectorAll('.draft-pick-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const pick = parseInt(btn.dataset.pick, 10);
      const selections = getDraftSelections();
      const playerId = selections[String(pick)];
      if (playerId) {
        unassignPlayer(playerId, getEntries(), getAssignments());
        setDraftPick(pick, null);
        renderDraft();
        renderTeams();
        renderLeaderboard();
      }
    });
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const PAGE_TITLES = { leaderboard: 'Leaderboard', teams: 'Teams & rosters', pool: 'Player pool', bracket: 'Bracket', draft: 'Draft order' };

function route() {
  const hash = (window.location.hash || '#leaderboard').slice(1);
  document.querySelectorAll('[data-view]').forEach(v => {
    v.hidden = v.dataset.view !== hash;
  });
  document.querySelectorAll('.nav a').forEach(a => {
    const isActive = a.getAttribute('href') === '#' + hash;
    a.classList.toggle('active', isActive);
    a.setAttribute('aria-current', isActive ? 'page' : null);
  });
  const pageName = PAGE_TITLES[hash] || 'March Madness Draft';
  document.title = pageName + ' — March Madness Player Draft';

  if (hash === 'leaderboard') {
    renderLeaderboard();
    ESPN.scoreboard().then(data => {
      ensureGameIdsInCache(data, () => renderLeaderboard());
    }).catch(() => renderLeaderboard());
  } else if (hash === 'teams') {
    renderTeams();
  } else if (hash === 'pool') {
    renderPool();
    if (Object.keys(getPool()).length === 0) {
      const statusEl = document.getElementById('pool-tournament-status');
      if (statusEl) {
        statusEl.textContent = 'Loading top scorers from this season…';
        statusEl.className = 'refresh-status';
      }
      refreshPoolFromTopScorers((cur, tot, msg) => {
        if (statusEl) statusEl.textContent = msg || `Loading ${cur}/${tot}…`;
      }).then(() => {
        if (statusEl) { statusEl.textContent = 'Loaded.'; statusEl.className = 'refresh-status status-success'; }
        renderPool();
        renderTeams();
        setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.className = 'refresh-status'; } }, 2500);
      }).catch(e => {
        if (statusEl) { statusEl.textContent = 'Error: ' + (e.message || 'Could not load.'); statusEl.className = 'refresh-status status-error'; }
      });
    }
  } else if (hash === 'bracket') {
    renderBracket();
  } else if (hash === 'draft') {
    renderDraft();
  }
}

const NAV_HTML = `
  <a href="#leaderboard">Leaderboard</a>
  <a href="#teams">Teams</a>
  <a href="#pool">Player pool</a>
  <a href="#draft">Draft order</a>
  <a href="#bracket">Bracket</a>
`;

function init() {
  const gate = document.getElementById('auth-gate');
  const appWrap = document.getElementById('app-wrap');

  if (!GOOGLE_CLIENT_ID) {
    if (gate) gate.hidden = true;
    if (appWrap) appWrap.hidden = false;
    runAppInit();
    return;
  }

  const user = getAuthUser();
  if (user) {
    if (gate) gate.hidden = true;
    if (appWrap) appWrap.hidden = false;
    renderAuthHeader(user);
    runAppInit();
    return;
  }

  if (getSkippedAuth()) {
    if (gate) gate.hidden = true;
    if (appWrap) appWrap.hidden = false;
    renderAuthHeader(null);
    runAppInit();
    return;
  }

  showAuthGateAndListenForSkip();
}

function showAuthGateAndListenForSkip() {
  const gate = document.getElementById('auth-gate');
  const appWrap = document.getElementById('app-wrap');
  if (gate) gate.hidden = false;
  if (appWrap) appWrap.hidden = true;
  const btnEl = document.getElementById('google-signin-btn');
  if (btnEl) btnEl.innerHTML = '<span class="auth-btn-loading">Loading sign-in button…</span>';
  gsiRetryCount = 0;
  initGoogleSignIn();
  const skipBtn = document.getElementById('auth-skip-btn');
  if (skipBtn) {
    skipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSkippedAuth(true);
      showAuthGate(false);
      if (appWrap) appWrap.hidden = false;
      renderAuthHeader(null);
      try {
        runAppInit();
      } catch (err) {
        console.error('App init after skip:', err);
      }
    }, { once: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
