const express = require('express');
const path = require('path');
const store = require('./store');

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
function computeStandings(tournament) {
  if (tournament.format === 'fixed') {
    const table = tournament.teams.map(t => ({
      id: t.id,
      name: t.name,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0
    }));
    const byId = Object.fromEntries(table.map(t => [t.id, t]));

    tournament.games.forEach(g => {
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
  const table = tournament.players.map(p => ({
    id: p.id,
    name: p.name,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0
  }));
  const byId = Object.fromEntries(table.map(p => [p.id, p]));

  tournament.games.forEach(g => {
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

// ---------- routes ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

app.get('/api/tournament', (req, res) => {
  const data = store.readData();
  if (!data.tournament) return res.json({ tournament: null, standings: [] });
  res.json({ tournament: data.tournament, standings: computeStandings(data.tournament) });
});

app.post('/api/tournament', requireAdmin, async (req, res) => {
  const { players: rawPlayers, format, numRounds } = req.body || {};

  if (!Array.isArray(rawPlayers) || rawPlayers.length < 4) {
    return res.status(400).json({ error: 'Enter at least 4 player names.' });
  }
  if (!['fixed', 'rotating'].includes(format)) {
    return res.status(400).json({ error: 'Format must be "fixed" or "rotating".' });
  }

  const names = rawPlayers.map(n => String(n).trim()).filter(Boolean);
  if (names.length !== rawPlayers.length) {
    return res.status(400).json({ error: 'All player names must be filled in.' });
  }
  if (format === 'fixed' && names.length % 2 !== 0) {
    return res.status(400).json({ error: 'Fixed-team format needs an even number of players.' });
  }

  const players = names.map((name, i) => ({ id: i + 1, name }));
  let games = [];
  let teams = [];

  if (format === 'fixed') {
    const built = buildFixedSchedule(players);
    teams = built.teams;
    let gameId = 1;
    built.rounds.forEach((matches, roundIdx) => {
      matches.forEach(m => {
        games.push({
          id: gameId++,
          round: roundIdx + 1,
          teamAId: m.teamA.id,
          teamBId: m.teamB.id,
          teamAName: m.teamA.name,
          teamBName: m.teamB.name,
          teamAPlayerIds: m.teamA.playerIds,
          teamBPlayerIds: m.teamB.playerIds,
          scoreA: 0,
          scoreB: 0,
          completed: false
        });
      });
    });
  } else {
    const rounds = Math.max(1, Math.min(20, parseInt(numRounds, 10) || Math.min(players.length - 1, 6)));
    const built = buildRotatingSchedule(players, rounds);
    let gameId = 1;
    built.forEach((round, roundIdx) => {
      round.matches.forEach(m => {
        games.push({
          id: gameId++,
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

  const tournament = {
    format,
    players,
    teams,
    games,
    createdAt: new Date().toISOString()
  };

  try {
    await store.writeData({ tournament });
    res.json({ tournament, standings: computeStandings(tournament) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save tournament. Try again.' });
  }
});

app.post('/api/tournament/reset', requireAdmin, async (req, res) => {
  try {
    await store.writeData({ tournament: null });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not reset tournament. Try again.' });
  }
});

app.post('/api/games/:id/score', async (req, res) => {
  const data = store.readData();
  if (!data.tournament) return res.status(404).json({ error: 'No active tournament.' });

  const id = parseInt(req.params.id, 10);
  const { side, delta } = req.body || {};
  if (!['a', 'b'].includes(side) || ![1, -1].includes(delta)) {
    return res.status(400).json({ error: 'Invalid score update.' });
  }

  const game = data.tournament.games.find(g => g.id === id);
  if (!game) return res.status(404).json({ error: 'Game not found.' });

  if (side === 'a') game.scoreA = Math.max(0, game.scoreA + delta);
  else game.scoreB = Math.max(0, game.scoreB + delta);

  game.completed = isComplete(game.scoreA, game.scoreB);

  try {
    await store.writeData(data);
    res.json({ tournament: data.tournament, standings: computeStandings(data.tournament) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save score. Try again.' });
  }
});

store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Pickleball scoring app running on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error('Failed to initialize data store', e);
    process.exit(1);
  });
