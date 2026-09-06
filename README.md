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
| 💾 **Zero-database backend** | Everything persists to a single `data.json` file |

## 🚀 Getting Started

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

## 🏆 How It Works

**Public view** — anyone who opens the site sees the live standings and every game, and can tap **+ / −** to update a score. No login required.

**Admin setup** — tap the small **admin** link in the footer, log in (`admin` / `admin`), and you can:
- Choose the number of players and enter their names
- Pick **Fixed Teams** or **Rotating Partners**
- Generate the full match schedule
- Reset the tournament to start over

## 🛠️ Tech Stack

- **Backend:** Node.js + Express, persisting state to a local `data.json` file
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework

---

<sub>Website Sponsored and Created by **LJ Web Management LLC**</sub>
