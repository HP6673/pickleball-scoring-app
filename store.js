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

async function githubPush(data) {
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
  if (!res.ok) {
    throw new Error(`GitHub write failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  sha = json.content.sha;
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
    chain = chain.then(() => githubPush(data));
    await chain;
  } else {
    localWrite(data);
  }
}

module.exports = { init, readData, writeData };
