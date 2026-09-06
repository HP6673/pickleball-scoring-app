# 🥒🏓 [Pickleball Tournament Scoreboard](https://github.com/HP6673/pickleball-scoring-app)

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-3c873a?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-0f4c5c?logo=express&logoColor=white)](https://expressjs.com)
[![Storage](https://img.shields.io/badge/Storage-JSON%20file-d7f24a?labelColor=0f4c5c)](#-how-it-works)
[![Made by](https://img.shields.io/badge/Made%20by-LJ%20Web%20Management%20LLC-0f4c5c)](https://github.com/HP6673)

A live, mobile-friendly scoreboard for pickleball tournaments — set up players and format once, then let anyone at the courts update scores in real time. No database, no build step, no accounts for players.

---

## ✨ Features

| | |
|---|---|
| 🎾 **Two tournament formats** | Fixed teams (round-robin schedule) or rotating partners (round robin mixer) |
| 🔢 **Standard scoring** | Games to 11, win by 2 |
| 📊 **Live standings** | Team wins/losses & point differential, or individual standings when partners rotate |
| 🔓 **Open scoring** | Anyone can update a score — no login needed courtside |
| 🔒 **Hidden admin setup** | A quiet "admin" link gates tournament creation/reset behind a login |
| 💾 **Zero-database backend** | Everything persists to a single `data.json` file — locally, or committed straight to this repo |

## 🚀 Getting Started

```bash
npm install
npm start
```

Then open **http://localhost:3000**. With no extra setup, tournament data is saved to a local `data.json` file.

## ☁️ Deploying (Render — free tier)

This app needs somewhere to actually *run* the Node server (GitHub Pages can't — it's static hosting only). **[Render](https://render.com)** has the most generous truly-free tier of the options considered (no credit card, no time-limited trial) — this repo includes a [render.yaml](render.yaml) Blueprint so setup is just:

1. Go to the [Render Blueprints dashboard](https://dashboard.render.com/blueprints) and click **New Blueprint Instance**.
2. Connect your GitHub account and select the `HP6673/pickleball-scoring-app` repo. Render reads `render.yaml` automatically.
3. When prompted for the `GITHUB_TOKEN` env var, paste in a GitHub [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to **just this repo** with **Contents: Read and write** permission (create it in GitHub first, then paste it into Render's dashboard — never share it anywhere else).
4. Click **Apply** / **Deploy**. Render builds with `npm install` and runs `npm start`.

Render's free web services spin down after ~15 minutes of inactivity and take a few seconds to wake back up on the next visit — harmless here since tournament data lives in this GitHub repo, not on Render's disk.

Any other Node host ([Railway](https://railway.app), [Fly.io](https://fly.io), a VPS, etc.) works too with the same build/start commands, if you'd rather use one of those instead.

### Persisting data to GitHub instead of local disk

By default the server writes to a local `data.json` file, which many free hosts wipe on restart. Set these environment variables on your host and it will read/write `data.json` **directly in this GitHub repo** via the GitHub API instead — no local disk needed:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GITHUB_TOKEN` | ✅ | — | A GitHub token with **Contents: Read and write** access to this repo. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to just this repository. Set it as a secret env var on your host — never commit it. |
| `GITHUB_REPO` | – | `HP6673/pickleball-scoring-app` | `owner/repo` to commit to |
| `GITHUB_BRANCH` | – | `main` | Branch to commit to |
| `GITHUB_FILE_PATH` | – | `data.json` | Path of the data file in the repo |

Every tournament setup change and every score tap becomes a commit to this repo, so expect a busy commit history during a live tournament — that's expected. If `GITHUB_TOKEN` isn't set, the app just uses the local file as normal.

## 🏆 How It Works

**Public view** — anyone who opens the site sees the live standings and every game, and can tap **+ / −** to update a score. No login required.

**Admin setup** — tap the small **admin** link in the footer, log in (`admin` / `admin`), and you can:
- Choose the number of players and enter their names
- Pick **Fixed Teams** or **Rotating Partners**
- Generate the full match schedule
- Reset the tournament to start over

## 🛠️ Tech Stack

- **Backend:** Node.js + Express, persisting state to `data.json` — locally, or via the GitHub Contents API (see [Deploying](#️-deploying))
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework

---

<sub>Website Sponsored and Created by **LJ Web Management LLC**</sub>
