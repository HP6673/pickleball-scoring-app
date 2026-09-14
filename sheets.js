// Optional Google Sheets integration: mirrors every game's score to a
// spreadsheet tab so scores can be entered either in the app or directly in
// the sheet. Entirely inert (every export becomes a no-op) unless credentials
// below are configured -- see README for setup instructions.
const fs = require('fs');
const { JWT } = require('google-auth-library');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Scores';

// Preferred credential source: a full service-account JSON file (e.g.
// Render's "Secret Files" feature). This avoids the fragile job of
// hand-escaping a multi-line private key into a single-line env var, which
// is easy to corrupt via copy/paste (stray real newlines break the PEM
// format and fail with an opaque OpenSSL "DECODER routines" error). Render
// mounts secret files under /etc/secrets/<filename>.
const JSON_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH || '/etc/secrets/google-service-account.json';

function loadCredentials() {
  try {
    if (fs.existsSync(JSON_KEY_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(JSON_KEY_PATH, 'utf8'));
      return { email: parsed.client_email, key: parsed.private_key };
    }
  } catch (e) {
    console.error('Failed to read Google service account JSON file:', e.message);
  }

  // Fallback: two separate env vars (used for local .env dev, or hosts
  // without a secret-file feature). The key is expected as one line with
  // literal "\n" sequences, which are unescaped here.
  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n')
  };
}

const credentials = loadCredentials();
const enabled = Boolean(SHEET_ID && credentials.email && credentials.key);

let client = null;
function getClient() {
  if (!client) {
    client = new JWT({
      email: credentials.email,
      key: credentials.key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }
  return client;
}

async function authHeaders() {
  const token = await getClient().getAccessToken();
  const value = typeof token === 'string' ? token : token.token;
  return { Authorization: `Bearer ${value}` };
}

function sheetsUrl(pathAndQuery) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${pathAndQuery}`;
}

function rangeParam(a1Range) {
  return encodeURIComponent(`${SHEET_TAB}!${a1Range}`);
}

const HEADER = ['Key', 'Type', 'Group', 'Round', 'Team A', 'Team B', 'Score A', 'Score B', 'Completed'];

function buildRows(tournament, resolvedBracket) {
  const rows = [HEADER];
  if (!tournament) return rows;

  const groupName = id => {
    const g = tournament.groups.find(gr => gr.id === id);
    return g ? g.name : '';
  };

  tournament.games.forEach(g => {
    rows.push([
      `game-${g.id}`, 'Group Play', groupName(g.group), g.round,
      g.teamAName, g.teamBName, g.scoreA, g.scoreB, g.completed ? 'Yes' : ''
    ]);
  });

  if (resolvedBracket) {
    resolvedBracket.rounds.forEach(r => {
      r.games.forEach(g => {
        rows.push([
          `bracket-${g.id}`, 'Bracket', '', `Bracket Round ${r.round}`,
          g.teamAName, g.teamBName,
          g.ready ? g.scoreA : '', g.ready ? g.scoreB : '',
          g.completed ? 'Yes' : ''
        ]);
      });
    });
  }

  return rows;
}

// Overwrites the whole sheet tab with the current schedule + scores. Safe to
// call often -- failures are logged and swallowed so a Sheets outage never
// breaks the app itself.
async function pushTournament(tournament, resolvedBracket) {
  if (!enabled) return;
  try {
    const headers = await authHeaders();

    // Clear a generously large range first so a shrunk or re-generated
    // tournament doesn't leave stale rows behind.
    await fetch(sheetsUrl(`/values/${rangeParam('A1:I5000')}:clear`), {
      method: 'POST',
      headers
    });

    const rows = buildRows(tournament, resolvedBracket);
    const res = await fetch(sheetsUrl(`/values/${rangeParam('A1')}?valueInputOption=RAW`), {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows })
    });
    if (!res.ok) {
      console.error('Google Sheets push failed:', res.status, await res.text());
    }
  } catch (e) {
    console.error('Google Sheets push failed:', e.message);
  }
}

// Reads back every Key/Score A/Score B row currently in the sheet.
async function pullScores() {
  if (!enabled) return [];
  try {
    const headers = await authHeaders();
    const res = await fetch(sheetsUrl(`/values/${rangeParam('A2:H5000')}`), { headers });
    if (!res.ok) {
      console.error('Google Sheets pull failed:', res.status, await res.text());
      return [];
    }
    const json = await res.json();
    const rows = json.values || [];
    return rows
      .filter(r => r[0])
      .map(r => ({ key: r[0], scoreA: r[6], scoreB: r[7] }));
  } catch (e) {
    console.error('Google Sheets pull failed:', e.message);
    return [];
  }
}

module.exports = { enabled, pushTournament, pullScores };
