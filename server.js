require('dotenv').config();

const express = require('express');
const path = require('path');
const store = require('./store');
const sheets = require('./sheets');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
// Lightweight shared-secret gate for admin-only setup actions.
// Not real security -- there is no user database, this just keeps casual
// visitors from stumbling into tournament setup/reset.
const ADMIN_TOKEN = 'lj-pb-9f3a2c7d';

const WIN_SCORE = 11;
const WIN_BY = 2;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Admin login required' });
  }
  next();
}

// Tournaments created before group-stage support have no `groups` array and
// no `group` field on players/teams/games. Backfill a single default group
// so old data keeps working without a manual migration.
function normalizeTournament(tournament) {
  if (!tournament || tournament.groups) return tournament;
  tournament.groups = [{ id: 1, name: 'Group A' }];
  tournament.players.forEach(p => { if (p.group == null) p.group = 1; });
  tournament.teams.forEach(t => { if (t.group == null) t.group = 1; });
  tournament.games.forEach(g => { if (g.group == null) g.group = 1; });
  return tournament;
}

function loadData() {
  const data = store.readData();
  normalizeTournament(data.tournament);
  return data;
}

// ---------- scheduling helpers ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pairKey(id1, id2) {
  return [id1, id2].sort((a, b) => a - b).join('-');
}

function buildFixedSchedule(players) {
  const teams = [];
  for (let i = 0; i < players.length; i += 2) {
    const p1 = players[i];
    const p2 = players[i + 1];
    teams.push({
      id: teams.length + 1,
      name: `${p1.name} / ${p2.name}`,
      playerIds: [p1.id, p2.id]
    });
  }

  let list = teams.slice();
  const hasBye = list.length % 2 !== 0;
  if (hasBye) list.push({ id: 0, name: 'BYE', playerIds: [] });

  const n = list.length;
  const rounds = [];
  let current = list.slice();
  for (let r = 0; r < n - 1; r++) {
    const matches = [];
    for (let i = 0; i < n / 2; i++) {
      const t1 = current[i];
      const t2 = current[n - 1 - i];
      if (t1.id !== 0 && t2.id !== 0) {
        matches.push({ teamA: t1, teamB: t2 });
      }
    }
    rounds.push(matches);
    const fixed = current[0];
    const rest = current.slice(1);
    rest.unshift(rest.pop());
    current = [fixed, ...rest];
  }
  return { teams, rounds };
}

function buildRotatingSchedule(players, numRounds) {
  const partnerCount = {};
  const sitOutCount = {};
  players.forEach(p => (sitOutCount[p.id] = 0));

  const rounds = [];
  for (let r = 0; r < numRounds; r++) {
    let pool = shuffle(players);
    let sitOutName = null;

    if (pool.length % 2 !== 0) {
      pool.sort((a, b) => sitOutCount[a.id] - sitOutCount[b.id]);
      const sitOut = pool[0];
      pool = shuffle(pool.slice(1));
      sitOutCount[sitOut.id]++;
      sitOutName = sitOut.name;
    }

    const remaining = pool.slice();
    const teamsThisRound = [];
    while (remaining.length > 0) {
      const p1 = remaining.shift();
      let bestIdx = 0;
      let bestCount = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = partnerCount[pairKey(p1.id, remaining[i].id)] || 0;
        if (c < bestCount) {
          bestCount = c;
          bestIdx = i;
        }
      }
      const p2 = remaining.splice(bestIdx, 1)[0];
      partnerCount[pairKey(p1.id, p2.id)] = (partnerCount[pairKey(p1.id, p2.id)] || 0) + 1;
      teamsThisRound.push({ playerIds: [p1.id, p2.id], name: `${p1.name} / ${p2.name}` });
    }

    const shuffledTeams = shuffle(teamsThisRound);
    const matches = [];
    for (let i = 0; i + 1 < shuffledTeams.length; i += 2) {
      matches.push({ teamA: shuffledTeams[i], teamB: shuffledTeams[i + 1] });
    }
    let byeTeamName = null;
    if (shuffledTeams.length % 2 !== 0) {
      byeTeamName = shuffledTeams[shuffledTeams.length - 1].name;
    }

    rounds.push({ matches, sitOut: sitOutName, byeTeam: byeTeamName });
  }
  return rounds;
}

function isComplete(scoreA, scoreB) {
  if (scoreA < WIN_SCORE && scoreB < WIN_SCORE) return false;
  return Math.abs(scoreA - scoreB) >= WIN_BY;
}

// ---------- standings ----------
// Computes a W/L/PF/PA table for one group's entities (teams, for fixed
// format, or players, for rotating format) from that group's games only.
function computeStandingsTable(tournament, groupId) {
  if (tournament.format === 'fixed') {
    const table = tournament.teams
      .filter(t => t.group === groupId)
      .map(t => ({ id: t.id, name: t.name, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }));
    const byId = Object.fromEntries(table.map(t => [t.id, t]));

    tournament.games
      .filter(g => g.group === groupId)
      .forEach(g => {
        if (!g.completed) return;
        const a = byId[g.teamAId];
        const b = byId[g.teamBId];
        if (!a || !b) return;
        a.pointsFor += g.scoreA;
        a.pointsAgainst += g.scoreB;
        b.pointsFor += g.scoreB;
        b.pointsAgainst += g.scoreA;
        if (g.scoreA > g.scoreB) {
          a.wins++;
          b.losses++;
        } else {
          b.wins++;
          a.losses++;
        }
      });

    table.forEach(t => (t.diff = t.pointsFor - t.pointsAgainst));
    table.sort((x, y) => y.wins - x.wins || y.diff - x.diff);
    return table;
  }

  // rotating: individual standings
  const table = tournament.players
    .filter(p => p.group === groupId)
    .map(p => ({ id: p.id, name: p.name, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }));
  const byId = Object.fromEntries(table.map(p => [p.id, p]));

  tournament.games
    .filter(g => g.group === groupId)
    .forEach(g => {
      if (!g.completed) return;
      g.teamAPlayerIds.forEach(pid => {
        const p = byId[pid];
        if (!p) return;
        p.pointsFor += g.scoreA;
        p.pointsAgainst += g.scoreB;
        if (g.scoreA > g.scoreB) p.wins++;
        else p.losses++;
      });
      g.teamBPlayerIds.forEach(pid => {
        const p = byId[pid];
        if (!p) return;
        p.pointsFor += g.scoreB;
        p.pointsAgainst += g.scoreA;
        if (g.scoreB > g.scoreA) p.wins++;
        else p.losses++;
      });
    });

  table.forEach(p => (p.diff = p.pointsFor - p.pointsAgainst));
  table.sort((x, y) => y.wins - x.wins || y.diff - x.diff);
  return table;
}

// Returns one standings table per group: [{ groupId, groupName, standings }]
function computeStandings(tournament) {
  return tournament.groups.map(g => ({
    groupId: g.id,
    groupName: g.name,
    standings: computeStandingsTable(tournament, g.id)
  }));
}

// ---------- bracket ----------
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

// Validates an "advance per group" choice and returns an error string, or
// null if the choice produces a playable single-elimination bracket.
function validateAdvancePerGroup(tournament, advancePerGroup) {
  const K = advancePerGroup;
  if (!Number.isInteger(K) || K < 1) {
    return 'Enter a valid number of advancers per group.';
  }
  if (tournament.format === 'rotating' && K % 2 !== 0) {
    return 'For Rotating Partners, the number advancing per group must be even (they are paired into playoff teams).';
  }

  for (const g of tournament.groups) {
    const count = tournament.format === 'fixed'
      ? tournament.teams.filter(t => t.group === g.id).length
      : tournament.players.filter(p => p.group === g.id).length;
    if (K > count) {
      return `${g.name} only has ${count} ${tournament.format === 'fixed' ? 'team(s)' : 'player(s)'}.`;
    }
  }

  const teamsPerGroup = tournament.format === 'fixed' ? K : K / 2;
  const total = tournament.groups.length * teamsPerGroup;
  if (!isPowerOfTwo(total)) {
    return `${tournament.groups.length} groups × ${teamsPerGroup} playoff team(s) each = ${total}, which isn't a valid bracket size (must be 2, 4, 8, 16...).`;
  }
  return null;
}

// Standard single-elimination seeding order (e.g. size 8 -> [1,8,4,5,2,7,3,6])
// so top seeds are spread apart and can only meet in later rounds.
function seedOrder(size) {
  let seeds = [1];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    const next = [];
    seeds.forEach(s => {
      next.push(s);
      next.push(n + 1 - s);
    });
    seeds = next;
  }
  return seeds;
}

// Builds bracket seed entries from each group's standings, taking the top
// `advancePerGroup` from every group and interleaving group-by-group within
// each rank tier (all rank-1 finishers, then all rank-2 finishers, ...) so
// same-group qualifiers land far apart in the standard seeding order and
// can't meet again until the later rounds.
function bracketSeedsFromGroupStandings(tournament, groupStandings, advancePerGroup) {
  const K = advancePerGroup;

  const groupQualifiers = groupStandings.map(gs => {
    const top = gs.standings.slice(0, K);
    if (tournament.format === 'fixed') {
      return top.map(row => ({ name: row.name, playerIds: null }));
    }
    // rotating: pair the strongest and weakest of this group's qualifiers
    // together (rank i with rank K-1-i) so each playoff team is balanced.
    const half = K / 2;
    const teams = [];
    for (let i = 0; i < half; i++) {
      const p1 = top[i];
      const p2 = top[K - 1 - i];
      teams.push({ name: `${p1.name} / ${p2.name}`, playerIds: [p1.id, p2.id] });
    }
    return teams;
  });

  const perGroup = groupQualifiers[0].length;
  const seeds = [];
  for (let rank = 0; rank < perGroup; rank++) {
    groupQualifiers.forEach(qualifiers => seeds.push(qualifiers[rank]));
  }
  return seeds;
}

function buildBracketRounds(size, seeds) {
  const order = seedOrder(size);
  let gameId = 1;

  const round1Games = [];
  for (let i = 0; i < order.length; i += 2) {
    const seedA = order[i];
    const seedB = order[i + 1];
    round1Games.push({
      id: gameId++,
      round: 1,
      slotA: { seed: seedA, name: seeds[seedA - 1].name, playerIds: seeds[seedA - 1].playerIds },
      slotB: { seed: seedB, name: seeds[seedB - 1].name, playerIds: seeds[seedB - 1].playerIds },
      scoreA: 0,
      scoreB: 0,
      completed: false
    });
  }

  const rounds = [{ round: 1, games: round1Games }];
  let prev = round1Games;
  let roundNum = 2;
  while (prev.length > 1) {
    const games = [];
    for (let i = 0; i < prev.length; i += 2) {
      games.push({
        id: gameId++,
        round: roundNum,
        slotA: { fromGameId: prev[i].id },
        slotB: { fromGameId: prev[i + 1].id },
        scoreA: 0,
        scoreB: 0,
        completed: false
      });
    }
    rounds.push({ round: roundNum, games });
    prev = games;
    roundNum++;
  }
  return rounds;
}

function resolveBracket(bracket) {
  if (!bracket) return null;

  const gameById = {};
  bracket.rounds.forEach(r => r.games.forEach(g => (gameById[g.id] = g)));
  const winnerCache = {};

  function winnerOf(game) {
    if (winnerCache[game.id] !== undefined) return winnerCache[game.id];
    let winner = null;
    if (game.completed) {
      winner = game.scoreA > game.scoreB ? resolveSlot(game.slotA) : resolveSlot(game.slotB);
    }
    winnerCache[game.id] = winner;
    return winner;
  }

  function resolveSlot(slot) {
    if (!slot) return null;
    if (slot.fromGameId != null) {
      const feeder = gameById[slot.fromGameId];
      return feeder ? winnerOf(feeder) : null;
    }
    return { name: slot.name, playerIds: slot.playerIds, seed: slot.seed };
  }

  const rounds = bracket.rounds.map(r => ({
    round: r.round,
    games: r.games.map(g => {
      const a = resolveSlot(g.slotA);
      const b = resolveSlot(g.slotB);
      return {
        id: g.id,
        round: g.round,
        teamAName: a ? a.name : `Winner of Game ${g.slotA.fromGameId}`,
        teamBName: b ? b.name : `Winner of Game ${g.slotB.fromGameId}`,
        ready: Boolean(a && b),
        scoreA: g.scoreA,
        scoreB: g.scoreB,
        completed: g.completed
      };
    })
  }));

  return { size: bracket.size, advancePerGroup: bracket.advancePerGroup, rounds };
}

// ---------- routes ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/tournament', (req, res) => {
  const data = loadData();
  if (!data.tournament) return res.json({ tournament: null, standings: [], bracket: null, title: data.title });
  res.json({
    tournament: data.tournament,
    standings: computeStandings(data.tournament),
    bracket: resolveBracket(data.tournament.bracket),
    title: data.title
  });
});

app.post('/api/settings/title', requireAdmin, async (req, res) => {
  const title = String((req.body && req.body.title) || '').trim();
  if (!title || title.length > 80) {
    return res.status(400).json({ error: 'Title must be between 1 and 80 characters.' });
  }

  const data = loadData();
  data.title = title;

  try {
    await store.writeData(data);
    res.json({ title: data.title });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save title. Try again.' });
  }
});

app.post('/api/tournament', requireAdmin, async (req, res) => {
  const { players: rawPlayers, format, numRounds, numGroups: rawNumGroups } = req.body || {};

  if (!Array.isArray(rawPlayers) || rawPlayers.length < 4) {
    return res.status(400).json({ error: 'Enter at least 4 player names.' });
  }
  if (!['fixed', 'rotating'].includes(format)) {
    return res.status(400).json({ error: 'Format must be "fixed" or "rotating".' });
  }

  const numGroups = Math.max(1, Math.min(8, parseInt(rawNumGroups, 10) || 1));
  const groups = Array.from({ length: numGroups }, (_, i) => ({
    id: i + 1,
    name: `Group ${String.fromCharCode(65 + i)}`
  }));
  const groupIds = new Set(groups.map(g => g.id));

  const entries = rawPlayers.map(p => (typeof p === 'object' && p ? p : { name: p }));
  const names = entries.map(p => String(p.name || '').trim());
  if (names.some(n => !n)) {
    return res.status(400).json({ error: 'All player names must be filled in.' });
  }
  const entryGroups = entries.map(p => parseInt(p.group, 10) || 1);
  if (entryGroups.some(g => !groupIds.has(g))) {
    return res.status(400).json({ error: 'Every player must be assigned to a valid group.' });
  }

  if (format === 'fixed' && names.length % 2 !== 0) {
    return res.status(400).json({ error: 'Fixed-team format needs an even number of players.' });
  }

  const players = names.map((name, i) => ({ id: i + 1, name, group: entryGroups[i] }));
  let games = [];
  let teams = [];
  let gameId = 1;
  let teamId = 1;

  if (format === 'fixed') {
    // Consecutive players (i, i+1) form a team, so both must share a group --
    // reject a manual assignment that splits a pair across two groups.
    for (let i = 0; i < players.length; i += 2) {
      if (players[i].group !== players[i + 1].group) {
        return res.status(400).json({ error: `${players[i].name} and ${players[i + 1].name} are teammates and must be in the same group.` });
      }
    }

    for (const g of groups) {
      const groupPlayers = players.filter(p => p.group === g.id);
      if (groupPlayers.length < 2) {
        return res.status(400).json({ error: `${g.name} needs at least 2 players (1 team).` });
      }
      const built = buildFixedSchedule(groupPlayers);
      const groupTeamsById = {};
      built.teams.forEach(t => {
        const globalTeam = { id: teamId++, name: t.name, playerIds: t.playerIds, group: g.id };
        teams.push(globalTeam);
        groupTeamsById[t.id] = globalTeam;
      });
      built.rounds.forEach((matches, roundIdx) => {
        matches.forEach(m => {
          const teamA = groupTeamsById[m.teamA.id];
          const teamB = groupTeamsById[m.teamB.id];
          games.push({
            id: gameId++,
            group: g.id,
            round: roundIdx + 1,
            teamAId: teamA.id,
            teamBId: teamB.id,
            teamAName: teamA.name,
            teamBName: teamB.name,
            teamAPlayerIds: teamA.playerIds,
            teamBPlayerIds: teamB.playerIds,
            scoreA: 0,
            scoreB: 0,
            completed: false
          });
        });
      });
    }
  } else {
    const rounds = Math.max(1, Math.min(20, parseInt(numRounds, 10) || 6));
    for (const g of groups) {
      const groupPlayers = players.filter(p => p.group === g.id);
      if (groupPlayers.length < 4) {
        return res.status(400).json({ error: `${g.name} needs at least 4 players.` });
      }
      const groupRounds = Math.min(rounds, groupPlayers.length - 1);
      const built = buildRotatingSchedule(groupPlayers, groupRounds);
      built.forEach((round, roundIdx) => {
        round.matches.forEach(m => {
          games.push({
            id: gameId++,
            group: g.id,
            round: roundIdx + 1,
            teamAName: m.teamA.name,
            teamBName: m.teamB.name,
            teamAPlayerIds: m.teamA.playerIds,
            teamBPlayerIds: m.teamB.playerIds,
            scoreA: 0,
            scoreB: 0,
            completed: false,
            sitOut: round.sitOut,
            byeTeam: round.byeTeam
          });
        });
      });
    }
  }

  const tournament = {
    format,
    groups,
    players,
    teams,
    games,
    bracket: null,
    createdAt: new Date().toISOString()
  };

  try {
    await store.writeData({ tournament });
    sheets.pushTournament(tournament, null);
    res.json({ tournament, standings: computeStandings(tournament), bracket: null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save tournament. Try again.' });
  }
});

app.post('/api/tournament/reset', requireAdmin, async (req, res) => {
  try {
    await store.writeData({ tournament: null });
    sheets.pushTournament(null, null);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not reset tournament. Try again.' });
  }
});

function isValidScoreValue(n) {
  return Number.isInteger(n) && n >= 0 && n <= 99;
}

app.post('/api/games/:id/score/set', async (req, res) => {
  const data = loadData();
  if (!data.tournament) return res.status(404).json({ error: 'No active tournament.' });

  const id = parseInt(req.params.id, 10);
  const scoreA = Number(req.body && req.body.scoreA);
  const scoreB = Number(req.body && req.body.scoreB);
  if (!isValidScoreValue(scoreA) || !isValidScoreValue(scoreB)) {
    return res.status(400).json({ error: 'Scores must be whole numbers between 0 and 99.' });
  }

  const game = data.tournament.games.find(g => g.id === id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  game.scoreA = scoreA;
  game.scoreB = scoreB;
  game.completed = isComplete(game.scoreA, game.scoreB);

  try {
    await store.writeData(data);
    sheets.pushTournament(data.tournament, resolveBracket(data.tournament.bracket));
    res.json({
      tournament: data.tournament,
      standings: computeStandings(data.tournament),
      bracket: resolveBracket(data.tournament.bracket)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save score. Try again.' });
  }
});

app.post('/api/bracket/generate', requireAdmin, async (req, res) => {
  const data = loadData();
  if (!data.tournament) return res.status(404).json({ error: 'No active tournament.' });

  const advancePerGroup = parseInt(req.body && req.body.advancePerGroup, 10);
  const validationError = validateAdvancePerGroup(data.tournament, advancePerGroup);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const standings = computeStandings(data.tournament);
  const seeds = bracketSeedsFromGroupStandings(data.tournament, standings, advancePerGroup);
  const size = seeds.length;
  data.tournament.bracket = {
    size,
    advancePerGroup,
    rounds: buildBracketRounds(size, seeds),
    createdAt: new Date().toISOString()
  };

  try {
    await store.writeData(data);
    sheets.pushTournament(data.tournament, resolveBracket(data.tournament.bracket));
    res.json({
      tournament: data.tournament,
      standings,
      bracket: resolveBracket(data.tournament.bracket)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save bracket. Try again.' });
  }
});

app.post('/api/bracket/reset', requireAdmin, async (req, res) => {
  const data = loadData();
  if (!data.tournament) return res.status(404).json({ error: 'No active tournament.' });

  data.tournament.bracket = null;

  try {
    await store.writeData(data);
    sheets.pushTournament(data.tournament, null);
    res.json({ tournament: data.tournament, standings: computeStandings(data.tournament), bracket: null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not clear bracket. Try again.' });
  }
});

app.post('/api/bracket/games/:id/score/set', async (req, res) => {
  const data = loadData();
  if (!data.tournament || !data.tournament.bracket) {
    return res.status(404).json({ error: 'No active bracket.' });
  }

  const id = parseInt(req.params.id, 10);
  const scoreA = Number(req.body && req.body.scoreA);
  const scoreB = Number(req.body && req.body.scoreB);
  if (!isValidScoreValue(scoreA) || !isValidScoreValue(scoreB)) {
    return res.status(400).json({ error: 'Scores must be whole numbers between 0 and 99.' });
  }

  let game = null;
  data.tournament.bracket.rounds.forEach(r => {
    const found = r.games.find(g => g.id === id);
    if (found) game = found;
  });
  if (!game) return res.status(404).json({ error: 'Bracket game not found.' });

  const resolved = resolveBracket(data.tournament.bracket);
  const resolvedGame = resolved.rounds.flatMap(r => r.games).find(g => g.id === id);
  if (!resolvedGame.ready) {
    return res.status(400).json({ error: 'Both teams for this match are not determined yet.' });
  }

  game.scoreA = scoreA;
  game.scoreB = scoreB;
  game.completed = isComplete(game.scoreA, game.scoreB);

  try {
    await store.writeData(data);
    sheets.pushTournament(data.tournament, resolveBracket(data.tournament.bracket));
    res.json({
      tournament: data.tournament,
      standings: computeStandings(data.tournament),
      bracket: resolveBracket(data.tournament.bracket)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save score. Try again.' });
  }
});

// ---------- Google Sheets two-way sync ----------
// Polls the sheet for score edits made directly there (rather than through
// the app) and applies them the same way the score-set routes do.
const SHEET_POLL_INTERVAL_MS = 10000;

async function syncScoresFromSheet() {
  if (!sheets.enabled) return;

  const data = loadData();
  if (!data.tournament) return;

  const rows = await sheets.pullScores();
  if (rows.length === 0) return;

  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  let changed = false;

  data.tournament.games.forEach(g => {
    const row = byKey[`game-${g.id}`];
    if (!row) return;
    const scoreA = Number(row.scoreA);
    const scoreB = Number(row.scoreB);
    if (!isValidScoreValue(scoreA) || !isValidScoreValue(scoreB)) return;
    if (scoreA === g.scoreA && scoreB === g.scoreB) return;
    g.scoreA = scoreA;
    g.scoreB = scoreB;
    g.completed = isComplete(scoreA, scoreB);
    changed = true;
  });

  if (data.tournament.bracket) {
    const readyById = {};
    resolveBracket(data.tournament.bracket).rounds.forEach(r => {
      r.games.forEach(g => (readyById[g.id] = g.ready));
    });

    data.tournament.bracket.rounds.forEach(r => {
      r.games.forEach(g => {
        const row = byKey[`bracket-${g.id}`];
        if (!row || !readyById[g.id]) return;
        const scoreA = Number(row.scoreA);
        const scoreB = Number(row.scoreB);
        if (!isValidScoreValue(scoreA) || !isValidScoreValue(scoreB)) return;
        if (scoreA === g.scoreA && scoreB === g.scoreB) return;
        g.scoreA = scoreA;
        g.scoreB = scoreB;
        g.completed = isComplete(scoreA, scoreB);
        changed = true;
      });
    });
  }

  if (changed) {
    await store.writeData(data);
    console.log('Applied score update(s) edited directly in the Google Sheet.');
  }
}

store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Pickleball scoring app running on http://localhost:${PORT}`);
    });
    if (sheets.enabled) {
      const data = loadData();
      sheets.pushTournament(data.tournament, data.tournament ? resolveBracket(data.tournament.bracket) : null);
      setInterval(() => {
        syncScoresFromSheet().catch(e => console.error('Google Sheet sync failed:', e));
      }, SHEET_POLL_INTERVAL_MS);
      console.log(`Google Sheet sync enabled, polling every ${SHEET_POLL_INTERVAL_MS / 1000}s.`);
    } else {
      console.log('Google Sheet sync disabled (set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY to enable).');
    }
  })
  .catch((e) => {
    console.error('Failed to initialize data store', e);
    process.exit(1);
  });
