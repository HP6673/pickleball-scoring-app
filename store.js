const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'HP6673/pickleball-scoring-app';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_FILE_PATH = process.env.GITHUB_FILE_PATH || 'data.json';

const useGitHub = Boolean(GITHUB_TOKEN);

let cache = { tournament: null };
let sha = null;
let chain = Promise.resolve();

function contentsUrl() {
  return `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pickleball-scoring-app'
  };
}

async function githubFetch() {
  const res = await fetch(`${contentsUrl()}?ref=${GITHUB_BRANCH}`, { headers: githubHeaders() });
  if (res.status === 404) {
    return { data: { tournament: null }, sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub read failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const content = Buffer.from(json.content, 'base64').toString('utf8');
  return { data: content.trim() ? JSON.parse(content) : { tournament: null }, sha: json.sha };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function githubPushOnce(data) {
  const body = {
    message: `Update tournament data (${new Date().toISOString()})`,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const res = await fetch(contentsUrl(), {
    method: 'PUT',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    const json = await res.json();
    sha = json.content.sha;
    return;
  }

  const errText = await res.text();
  const err = new Error(`GitHub write failed: ${res.status} ${errText}`);
  err.status = res.status;
  throw err;
}

// GitHub's Contents API can transiently reject rapid back-to-back writes to the
// same file (secondary rate limiting) or reject a stale sha if two writes race.
// Retry those cases instead of surfacing an error on every quick double-tap.
async function githubPush(data) {
  const maxAttempts = 4;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        // sha may be stale after a conflict; re-sync with the latest commit first.
        const remote = await githubFetch();
        sha = remote.sha;
      }
      await githubPushOnce(data);
      return;
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 403 || e.status === 409 || e.status === 429 || e.status >= 500;
      if (!retryable || attempt === maxAttempts) break;
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

function localRead() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { tournament: null };
  }
}

function localWrite(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function init() {
  if (useGitHub) {
    const remote = await githubFetch();
    cache = remote.data;
    sha = remote.sha;
    console.log(`Tournament data persists to GitHub (${GITHUB_REPO}, branch ${GITHUB_BRANCH}).`);
  } else {
    cache = localRead();
    console.log('Tournament data persists to local data.json. Set GITHUB_TOKEN to persist to GitHub instead.');
  }
}

function readData() {
  return cache;
}

async function writeData(data) {
  cache = data;
  if (useGitHub) {
    // Chain writes so they hit the GitHub API in order, but never let one
    // failed push poison the queue for every write that comes after it.
    const result = chain.then(() => githubPush(data));
    chain = result.catch(() => {});
    await result;
  } else {
    localWrite(data);
  }
}

module.exports = { init, readData, writeData };
