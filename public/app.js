(function () {
  const TOKEN_KEY = 'pb_admin_token';
  let currentTournament = null;
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
      render(data.tournament, data.standings);
    } catch (e) {
      console.error('Failed to load tournament', e);
    }
  }

  function render(tournament, standings) {
    const empty = el('empty-state');
    const board = el('scoreboard');

    if (!tournament) {
      empty.hidden = false;
      board.hidden = true;
      return;
    }
    empty.hidden = true;
    board.hidden = false;

    el('standings-title').textContent =
      tournament.format === 'fixed' ? 'Team Standings' : 'Player Standings';

    const tbody = document.querySelector('#standings-table tbody');
    tbody.innerHTML = '';
    standings.forEach((row, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(row.name)}</td>
        <td>${row.wins}</td>
        <td>${row.losses}</td>
        <td>${row.pointsFor}</td>
        <td>${row.pointsAgainst}</td>
        <td>${row.diff > 0 ? '+' : ''}${row.diff}</td>
      `;
      tbody.appendChild(tr);
    });

    renderRounds(tournament);
  }

  function renderRounds(tournament) {
    const container = el('rounds-container');
    container.innerHTML = '';

    const byRound = {};
    tournament.games.forEach((g) => {
      (byRound[g.round] = byRound[g.round] || []).push(g);
    });

    Object.keys(byRound)
      .sort((a, b) => a - b)
      .forEach((roundNum) => {
        const heading = document.createElement('h3');
        heading.className = 'round-heading';
        heading.textContent = `Round ${roundNum}`;
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
  }

  function buildGameCard(game) {
    const card = document.createElement('div');
    card.className = 'game-card' + (game.completed ? ' completed' : '');

    card.innerHTML = `
      <div class="team-row">
        <span class="team-name">${escapeHtml(game.teamAName)}</span>
        <div class="score-control" data-side="a">
          <button class="score-btn minus" data-action="dec">&minus;</button>
          <span class="score-value">${game.scoreA}</span>
          <button class="score-btn plus" data-action="inc">+</button>
        </div>
      </div>
      <div class="vs-divider">VS</div>
      <div class="team-row">
        <span class="team-name">${escapeHtml(game.teamBName)}</span>
        <div class="score-control" data-side="b">
          <button class="score-btn minus" data-action="dec">&minus;</button>
          <span class="score-value">${game.scoreB}</span>
          <button class="score-btn plus" data-action="inc">+</button>
        </div>
      </div>
      ${game.completed ? `<span class="final-badge">Final ${Math.max(game.scoreA, game.scoreB)}-${Math.min(game.scoreA, game.scoreB)}</span>` : ''}
    `;

    card.querySelectorAll('.score-control').forEach((control) => {
      const side = control.dataset.side;
      control.querySelectorAll('.score-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const delta = btn.dataset.action === 'inc' ? 1 : -1;
          updateScore(game.id, side, delta);
        });
      });
    });

    return card;
  }

  async function updateScore(gameId, side, delta) {
    try {
      const res = await fetch(`/api/games/${gameId}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, delta })
      });
      const data = await res.json();
      if (res.ok) {
        currentTournament = data.tournament;
        render(data.tournament, data.standings);
      }
    } catch (e) {
      console.error('Failed to update score', e);
    }
  }

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
    buildPlayerFields();
  }
  el('admin-close').addEventListener('click', () => (adminModal.hidden = true));

  const numPlayersInput = el('num-players');
  const formatSelect = el('format-select');
  const roundsField = el('rounds-field');

  function toggleRoundsField() {
    roundsField.style.display = formatSelect.value === 'rotating' ? '' : 'none';
  }
  formatSelect.addEventListener('change', toggleRoundsField);
  toggleRoundsField();

  function buildPlayerFields() {
    const count = Math.max(4, Math.min(40, parseInt(numPlayersInput.value, 10) || 0));
    const grid = el('player-names');
    const existing = Array.from(grid.querySelectorAll('input')).map((i) => i.value);
    grid.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const label = document.createElement('label');
      label.textContent = `Player ${i + 1}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.required = true;
      input.value = existing[i] || '';
      input.placeholder = `Player ${i + 1} name`;
      label.appendChild(input);
      grid.appendChild(label);
    }
  }
  numPlayersInput.addEventListener('change', buildPlayerFields);
  numPlayersInput.addEventListener('input', buildPlayerFields);

  el('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = el('setup-error');
    errEl.hidden = true;

    const players = Array.from(el('player-names').querySelectorAll('input')).map((i) => i.value.trim());
    const format = formatSelect.value;
    const numRounds = el('num-rounds').value;

    try {
      const res = await fetch('/api/tournament', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': getToken() || ''
        },
        body: JSON.stringify({ players, format, numRounds })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Could not create tournament';
        errEl.hidden = false;
        return;
      }
      adminModal.hidden = true;
      currentTournament = data.tournament;
      render(data.tournament, data.standings);
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

  // ---------- init ----------
  buildPlayerFields();
  loadTournament();
  pollTimer = setInterval(loadTournament, 4000);
})();
