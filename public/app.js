(function () {
  const TOKEN_KEY = 'pb_admin_token';
  let currentTournament = null;
  let currentBracket = null;
  let currentTitle = '';
  let pollTimer = null;

  const el = (id) => document.getElementById(id);

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  // ---------- data fetch + render ----------
  async function loadTournament() {
    try {
      const res = await fetch('/api/tournament');
      const data = await res.json();
      currentTournament = data.tournament;
      currentBracket = data.bracket;
      if (data.title) applyTitle(data.title);
      render(data.tournament, data.standings, data.bracket);
    } catch (e) {
      console.error('Failed to load tournament', e);
    }
  }

  function applyTitle(title) {
    currentTitle = title;
    el('site-title').textContent = title;
  }

  function render(tournament, standings, bracket) {
    const empty = el('empty-state');
    const board = el('scoreboard');

    if (!tournament) {
      empty.hidden = false;
      board.hidden = true;
      return;
    }
    empty.hidden = true;
    board.hidden = false;

    renderStandings(tournament, standings);
    renderBracket(bracket);
    renderRounds(tournament);
  }

  // ---------- standings ----------
  function renderStandings(tournament, groupStandings) {
    const container = el('standings-container');
    container.innerHTML = '';

    const baseTitle = tournament.format === 'fixed' ? 'Team Standings' : 'Player Standings';
    const multiGroup = groupStandings.length > 1;

    groupStandings.forEach((group) => {
      const card = document.createElement('div');
      card.className = 'card standings-card';

      const heading = document.createElement('h2');
      heading.textContent = multiGroup ? `${group.groupName} — ${baseTitle}` : baseTitle;
      card.appendChild(heading);

      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      const table = document.createElement('table');
      table.innerHTML = `
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>W</th>
            <th>L</th>
            <th>PF</th>
            <th>PA</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');
      group.standings.forEach((row, i) => {
        const tr = document.createElement('tr');
        const diffClass = row.diff > 0 ? 'diff-positive' : row.diff < 0 ? 'diff-negative' : 'diff-zero';
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td>${escapeHtml(row.name)}</td>
          <td><span class="pill pill-win">${row.wins}</span></td>
          <td><span class="pill pill-loss">${row.losses}</span></td>
          <td>${row.pointsFor}</td>
          <td>${row.pointsAgainst}</td>
          <td class="${diffClass}">${row.diff > 0 ? '+' : ''}${row.diff}</td>
        `;
        tbody.appendChild(tr);
      });
      wrap.appendChild(table);
      card.appendChild(wrap);
      container.appendChild(card);
    });
  }

  // ---------- bracket ----------
  function roundLabel(roundNum, totalRounds) {
    const fromEnd = totalRounds - roundNum;
    if (fromEnd === 0) return 'Final';
    if (fromEnd === 1) return 'Semifinals';
    if (fromEnd === 2) return 'Quarterfinals';
    return `Round ${roundNum}`;
  }

  function renderBracket(bracket) {
    const card = el('bracket-card');
    const container = el('bracket-container');
    const championEl = el('bracket-champion');
    container.innerHTML = '';
    championEl.hidden = true;

    if (!bracket) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const totalRounds = bracket.rounds.length;
    bracket.rounds.forEach((round) => {
      const col = document.createElement('div');
      col.className = 'bracket-round';

      const heading = document.createElement('h3');
      heading.className = 'bracket-round-heading';
      heading.textContent = roundLabel(round.round, totalRounds);
      col.appendChild(heading);

      round.games.forEach((g) => col.appendChild(buildBracketGameCard(g)));
      container.appendChild(col);
    });

    const finalRound = bracket.rounds[bracket.rounds.length - 1];
    const finalGame = finalRound && finalRound.games[0];
    if (finalGame && finalGame.completed) {
      const championName = finalGame.scoreA > finalGame.scoreB ? finalGame.teamAName : finalGame.teamBName;
      championEl.textContent = `🏆 Champion: ${championName}`;
      championEl.hidden = false;
    }
  }

  function buildBracketGameCard(game) {
    const card = document.createElement('div');
    const notReady = !game.ready;
    card.className = 'game-card bracket-game' + (game.completed ? ' completed' : '') + (notReady ? ' pending' : '');

    const aWins = game.completed && game.scoreA > game.scoreB;
    const bWins = game.completed && game.scoreB > game.scoreA;

    card.innerHTML = `
      <div class="team-row${aWins ? ' winner' : ''}">
        <span class="team-name"><span class="team-dot a"></span>${escapeHtml(game.teamAName)}</span>
        <span class="score-value">${game.ready ? game.scoreA : ''}</span>
      </div>
      <div class="vs-divider">VS</div>
      <div class="team-row${bWins ? ' winner' : ''}">
        <span class="team-name"><span class="team-dot b"></span>${escapeHtml(game.teamBName)}</span>
        <span class="score-value">${game.ready ? game.scoreB : ''}</span>
      </div>
      ${game.ready ? `
      <div class="card-actions">
        <button type="button" class="edit-score-btn" data-action="edit-score">Edit Score</button>
      </div>` : ''}
      ${game.completed ? `<span class="final-badge">Final ${Math.max(game.scoreA, game.scoreB)}-${Math.min(game.scoreA, game.scoreB)}</span>` : ''}
    `;

    if (game.ready) {
      card.querySelector('[data-action="edit-score"]').addEventListener('click', () => {
        openScoreModal(game, 'bracket');
      });
    }

    return card;
  }

  function renderRounds(tournament) {
    const container = el('rounds-container');
    container.innerHTML = '';

    const multiGroup = tournament.groups.length > 1;

    tournament.groups.forEach((group) => {
      const groupGames = tournament.games.filter((g) => g.group === group.id);
      if (groupGames.length === 0) return;

      if (multiGroup) {
        const groupHeading = document.createElement('h2');
        groupHeading.className = 'group-heading';
        groupHeading.textContent = group.name;
        container.appendChild(groupHeading);
      }

      const byRound = {};
      groupGames.forEach((g) => {
        (byRound[g.round] = byRound[g.round] || []).push(g);
      });

      Object.keys(byRound)
        .sort((a, b) => a - b)
        .forEach((roundNum) => {
          const heading = document.createElement('h3');
          heading.className = 'round-heading';
          heading.innerHTML = `<span class="round-badge">Round ${roundNum}</span>`;
          container.appendChild(heading);

          const games = byRound[roundNum];
          const note = games[0].sitOut || games[0].byeTeam;
          if (note) {
            const p = document.createElement('p');
            p.className = 'game-note';
            const parts = [];
            if (games[0].sitOut) parts.push(`${games[0].sitOut} sits out`);
            if (games[0].byeTeam) parts.push(`${games[0].byeTeam} has a bye`);
            p.textContent = parts.join(' · ');
            container.appendChild(p);
          }

          games.forEach((g) => container.appendChild(buildGameCard(g)));
        });
    });
  }

  function buildGameCard(game) {
    const card = document.createElement('div');
    card.className = 'game-card' + (game.completed ? ' completed' : '');

    const aWins = game.completed && game.scoreA > game.scoreB;
    const bWins = game.completed && game.scoreB > game.scoreA;

    card.innerHTML = `
      <div class="team-row${aWins ? ' winner' : ''}">
        <span class="team-name"><span class="team-dot a"></span>${escapeHtml(game.teamAName)}</span>
        <span class="score-value">${game.scoreA}</span>
      </div>
      <div class="vs-divider">VS</div>
      <div class="team-row${bWins ? ' winner' : ''}">
        <span class="team-name"><span class="team-dot b"></span>${escapeHtml(game.teamBName)}</span>
        <span class="score-value">${game.scoreB}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="edit-score-btn" data-action="edit-score">Edit Score</button>
      </div>
      ${game.completed ? `<span class="final-badge">Final ${Math.max(game.scoreA, game.scoreB)}-${Math.min(game.scoreA, game.scoreB)}</span>` : ''}
    `;

    card.querySelector('[data-action="edit-score"]').addEventListener('click', () => {
      openScoreModal(game, 'roundrobin');
    });

    return card;
  }

  // ---------- score edit modal ----------
  const scoreModal = el('score-modal');
  let editingGameId = null;
  let editingGameType = 'roundrobin';

  function openScoreModal(game, type) {
    editingGameId = game.id;
    editingGameType = type;
    el('score-edit-a-label').textContent = game.teamAName;
    el('score-edit-b-label').textContent = game.teamBName;
    el('score-edit-a').value = game.scoreA;
    el('score-edit-b').value = game.scoreB;
    el('score-edit-error').hidden = true;
    scoreModal.hidden = false;
    el('score-edit-a').focus();
  }

  el('score-cancel').addEventListener('click', () => (scoreModal.hidden = true));

  el('score-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = el('score-edit-error');
    errEl.hidden = true;

    const scoreA = parseInt(el('score-edit-a').value, 10);
    const scoreB = parseInt(el('score-edit-b').value, 10);

    try {
      const endpoint = editingGameType === 'bracket'
        ? `/api/bracket/games/${editingGameId}/score/set`
        : `/api/games/${editingGameId}/score/set`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoreA, scoreB })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Could not save score';
        errEl.hidden = false;
        return;
      }
      scoreModal.hidden = true;
      currentTournament = data.tournament;
      currentBracket = data.bracket;
      render(data.tournament, data.standings, data.bracket);
    } catch (e) {
      errEl.textContent = 'Something went wrong. Try again.';
      errEl.hidden = false;
    }
  });

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---------- admin: login ----------
  const loginModal = el('login-modal');
  const adminModal = el('admin-modal');

  el('admin-link').addEventListener('click', () => {
    if (getToken()) {
      openAdminModal();
    } else {
      loginModal.hidden = false;
    }
  });

  el('login-cancel').addEventListener('click', () => (loginModal.hidden = true));

  el('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = el('login-username').value.trim();
    const password = el('login-password').value;
    const errEl = el('login-error');
    errEl.hidden = true;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Login failed';
        errEl.hidden = false;
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      loginModal.hidden = true;
      el('login-form').reset();
      openAdminModal();
    } catch (e) {
      errEl.textContent = 'Login failed. Try again.';
      errEl.hidden = false;
    }
  });

  // ---------- admin: setup modal ----------
  function openAdminModal() {
    adminModal.hidden = false;
    el('hero-title-input').value = currentTitle;
    el('title-error').hidden = true;
    buildPlayerFields();
    refreshBracketAdminUI();
  }
  el('admin-close').addEventListener('click', () => (adminModal.hidden = true));

  el('title-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = el('title-error');
    errEl.hidden = true;

    const title = el('hero-title-input').value.trim();

    try {
      const res = await fetch('/api/settings/title', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': getToken() || ''
        },
        body: JSON.stringify({ title })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Could not save title';
        errEl.hidden = false;
        return;
      }
      applyTitle(data.title);
    } catch (e) {
      errEl.textContent = 'Something went wrong. Try again.';
      errEl.hidden = false;
    }
  });

  const numPlayersInput = el('num-players');
  const formatSelect = el('format-select');
  const numGroupsInput = el('num-groups');
  const roundsField = el('rounds-field');

  function toggleRoundsField() {
    roundsField.style.display = formatSelect.value === 'rotating' ? '' : 'none';
  }
  formatSelect.addEventListener('change', () => {
    toggleRoundsField();
    buildPlayerFields();
  });
  toggleRoundsField();

  function groupOptionsHtml(numGroups, selected) {
    return Array.from({ length: numGroups }, (_, i) => {
      const value = i + 1;
      const label = `Group ${String.fromCharCode(65 + i)}`;
      return `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;
    }).join('');
  }

  let lastGroupBuildCount = null;

  function buildPlayerFields() {
    const count = Math.max(4, Math.min(40, parseInt(numPlayersInput.value, 10) || 0));
    const numGroups = Math.max(1, Math.min(8, parseInt(numGroupsInput.value, 10) || 1));
    const format = formatSelect.value;
    const grid = el('player-names');

    const existingNames = Array.from(grid.querySelectorAll('input[data-role="name"]')).map((i) => i.value);
    // If the group count just changed, discard prior group picks so the
    // alternating default is recomputed for the new count instead of
    // leaving every row pinned to its old (now stale) group.
    const groupCountChanged = lastGroupBuildCount !== null && lastGroupBuildCount !== numGroups;
    const existingGroups = groupCountChanged
      ? []
      : Array.from(grid.querySelectorAll('select[data-role="group"]')).map((s) => parseInt(s.value, 10));
    lastGroupBuildCount = numGroups;
    grid.innerHTML = '';

    if (format === 'fixed') {
      for (let t = 0, i = 0; i < count; t++, i += 2) {
        const row = document.createElement('div');
        row.className = 'player-grid-row team-row-field';

        [i, i + 1].forEach((idx) => {
          if (idx >= count) return;
          const label = document.createElement('label');
          label.textContent = `Player ${idx + 1}`;
          const input = document.createElement('input');
          input.type = 'text';
          input.required = true;
          input.dataset.role = 'name';
          input.value = existingNames[idx] || '';
          input.placeholder = `Player ${idx + 1} name`;
          label.appendChild(input);
          row.appendChild(label);
        });

        const groupLabel = document.createElement('label');
        groupLabel.className = 'group-select-label';
        groupLabel.textContent = 'Group';
        const select = document.createElement('select');
        select.dataset.role = 'group';
        select.innerHTML = groupOptionsHtml(numGroups, existingGroups[i] || (t % numGroups) + 1);
        groupLabel.appendChild(select);
        row.appendChild(groupLabel);

        grid.appendChild(row);
      }
    } else {
      for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'player-grid-row player-row-field';

        const label = document.createElement('label');
        label.textContent = `Player ${i + 1}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.required = true;
        input.dataset.role = 'name';
        input.value = existingNames[i] || '';
        input.placeholder = `Player ${i + 1} name`;
        label.appendChild(input);
        row.appendChild(label);

        const groupLabel = document.createElement('label');
        groupLabel.className = 'group-select-label';
        groupLabel.textContent = 'Group';
        const select = document.createElement('select');
        select.dataset.role = 'group';
        select.innerHTML = groupOptionsHtml(numGroups, existingGroups[i] || (i % numGroups) + 1);
        groupLabel.appendChild(select);
        row.appendChild(groupLabel);

        grid.appendChild(row);
      }
    }
  }
  numPlayersInput.addEventListener('change', buildPlayerFields);
  numPlayersInput.addEventListener('input', buildPlayerFields);
  numGroupsInput.addEventListener('change', buildPlayerFields);
  numGroupsInput.addEventListener('input', buildPlayerFields);

  el('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = el('setup-error');
    errEl.hidden = true;

    const format = formatSelect.value;
    const grid = el('player-names');
    let players;
    if (format === 'fixed') {
      players = [];
      grid.querySelectorAll('.team-row-field').forEach((row) => {
        const group = row.querySelector('select[data-role="group"]').value;
        row.querySelectorAll('input[data-role="name"]').forEach((input) => {
          players.push({ name: input.value.trim(), group });
        });
      });
    } else {
      players = Array.from(grid.querySelectorAll('.player-row-field')).map((row) => ({
        name: row.querySelector('input[data-role="name"]').value.trim(),
        group: row.querySelector('select[data-role="group"]').value
      }));
    }

    const numRounds = el('num-rounds').value;
    const numGroups = numGroupsInput.value;

    try {
      const res = await fetch('/api/tournament', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': getToken() || ''
        },
        body: JSON.stringify({ players, format, numRounds, numGroups })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Could not create tournament';
        errEl.hidden = false;
        return;
      }
      adminModal.hidden = true;
      currentTournament = data.tournament;
      currentBracket = data.bracket;
      render(data.tournament, data.standings, data.bracket);
    } catch (e) {
      errEl.textContent = 'Something went wrong. Try again.';
      errEl.hidden = false;
    }
  });

  el('reset-tournament').addEventListener('click', async () => {
    if (!confirm('Reset the current tournament? This clears all games and scores.')) return;
    try {
      const res = await fetch('/api/tournament/reset', {
        method: 'POST',
        headers: { 'x-admin-token': getToken() || '' }
      });
      if (res.ok) {
        adminModal.hidden = true;
        loadTournament();
      }
    } catch (e) {
      console.error('Reset failed', e);
    }
  });

  // ---------- admin: bracket ----------
  function refreshBracketAdminUI() {
    const input = el('bracket-advance-input');
    const fieldLabel = el('bracket-advance-field');
    const statusEl = el('bracket-status');
    const hintEl = el('bracket-hint');
    const clearBtn = el('bracket-clear');
    const generateBtn = el('bracket-generate');
    el('bracket-error').hidden = true;

    if (!currentTournament) return;

    const groupWord = currentTournament.format === 'fixed' ? 'teams' : 'players';
    fieldLabel.firstChild.textContent = `Advance per Group (${groupWord}) `;

    const numGroups = currentTournament.groups.length;
    hintEl.textContent = currentTournament.format === 'rotating'
      ? `${numGroups} group(s) × (advancers ÷ 2 playoff teams) must total a power of 2 (2, 4, 8...). Advancers per group must be even.`
      : `${numGroups} group(s) × advancers must total a power of 2 (2, 4, 8...).`;

    if (currentBracket) {
      input.value = currentBracket.advancePerGroup;
      statusEl.textContent = `Bracket is live with ${currentBracket.size} playoff teams. Generating again will overwrite it with a fresh bracket seeded from current standings.`;
      clearBtn.hidden = false;
      generateBtn.textContent = 'Regenerate Bracket';
    } else {
      statusEl.textContent = 'No bracket yet. Generate one from the current standings once group play is underway.';
      clearBtn.hidden = true;
      generateBtn.textContent = 'Generate Bracket';
    }
  }

  el('bracket-generate').addEventListener('click', async () => {
    const errEl = el('bracket-error');
    errEl.hidden = true;
    const advancePerGroup = parseInt(el('bracket-advance-input').value, 10);

    if (currentBracket && !confirm('Regenerate the bracket from current standings? This clears any existing bracket scores.')) {
      return;
    }

    try {
      const res = await fetch('/api/bracket/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': getToken() || ''
        },
        body: JSON.stringify({ advancePerGroup })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Could not generate bracket';
        errEl.hidden = false;
        return;
      }
      currentTournament = data.tournament;
      currentBracket = data.bracket;
      render(data.tournament, data.standings, data.bracket);
      refreshBracketAdminUI();
    } catch (e) {
      errEl.textContent = 'Something went wrong. Try again.';
      errEl.hidden = false;
    }
  });

  el('bracket-clear').addEventListener('click', async () => {
    if (!confirm('Clear the playoff bracket?')) return;
    try {
      const res = await fetch('/api/bracket/reset', {
        method: 'POST',
        headers: { 'x-admin-token': getToken() || '' }
      });
      if (res.ok) {
        loadTournament();
        refreshBracketAdminUI();
      }
    } catch (e) {
      console.error('Bracket clear failed', e);
    }
  });

  // ---------- init ----------
  buildPlayerFields();
  loadTournament();
  pollTimer = setInterval(loadTournament, 4000);
})();
