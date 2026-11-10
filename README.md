# Pebolim Manager

A browser football-manager game for playing with friends. One player hosts from their browser and friends join with a 6-letter room code (peer-to-peer, no server, no accounts). Play it at **https://sif1.github.io/pebolim/**.

The game is in Portuguese (BR) or English (PT / EN buttons; each player picks their own). The home screen lists what's new in each version. [docs/ENGINE.md](docs/ENGINE.md) explains how the match engine, the AI and the economy work, with the numbers behind them.

## Features

**The world**: Brazil's Série A, B and C, Copa do Brasil and 10 state championships; the Big 5 European leagues (two divisions each) with their cups; Argentina and Uruguay; the Libertadores, Sul-Americana, Champions League and Europa League. Real clubs, crests, players and coaches, a living market, monthly awards and a coaching ranking.

**Match day**
- Every human match is live on screen at once, each with its own clock, a 2D pitch with Championship Manager-style highlights, line-by-line commentary, a momentum graph, live stats and player ratings
- Substitutions and position changes by drag and drop, tactics (posture, style, pressing, attack focus), and a half-time team talk that lifts or hurts the second half
- Penalty shootouts and in-match penalties you play kick by kick
- Derbies, sounds, and matches of 1 to 8 real minutes

**Your club**
- A dashboard with the next match, a scouting report (the AI coach's plan, the weak spot of their defence), the board, the fans and the table
- Squad, youth team, line-ups on a drawn pitch, preferred sides, potential stars (a scout's estimate for young players) and traits
- Contracts with automatic renewal, finances, ticket prices, stadium and training-centre works, pitch care, travel, injuries, suspensions and player development
- Energy that recovers per day of rest, so a packed calendar asks for rotation
- A season review, a trophy room and career records

**The market**
- Brasfoot-style search, bids between humans and the AI, sales, loans, auctions and pre-contracts
- Values follow the contract, stars have standards, rich AI clubs spend, and deadline day is busier

**Board and jobs**
- Season objectives, board confidence, meetings, warnings and a final ultimatum
- Sackings, job offers, and AI coaches who are hired and sacked too

**Interface**: a notification centre, keyboard shortcuts (`?` lists them), tooltips, and a layout that works on phones.

**Multiplayer and saves**: up to 8 managers in a host-authoritative room; small `.pebolim` save files anyone can download, plus an autosave in every browser.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL and click **Novo jogo** (new game). Keep **Abrir sala online** ticked to get a room code for friends; for friends on other networks, deploy it (below) so everyone opens the same public URL.

## How a session works

1. The host creates or loads a game; friends enter the room code and a name.
2. Everyone picks a club (or creates one, which replaces a club in that country's bottom division). In a loaded game you can resume a manager or take any free club; clubs whose managers are away stay reserved.
3. Between rounds everyone works on their own screen and clicks **Pronto** (ready); the host clicks **Continuar**.
4. On match day every human match plays live; the host then moves on to the round summary.
5. Anyone can click **Baixar save** (download save) at any time. If the host leaves, anyone can host again from their copy.

The host is authoritative: your clicks go to the host as commands, which it checks and applies, then broadcasts small patches (a compressed snapshot after each match day). It validates every message, rate-limits each player and caps resyncs. Keep the host's tab open during match days.

## Editing the database

Clubs, players and coaches live in spreadsheet-friendly CSVs in `data/db/`:

| File | Columns |
|---|---|
| `clubs-*.csv` | `key, name, short, country, state, city, lat, lon, color1, color2, stadium, capacity, rep, league, estadual, continent, contonly` (optional `coach, coach_nat`) |
| `players-*.csv` | `club, name, pos (GOL/LAT/ZAG/VOL/MEI/ATA), birth, str (1-99), nat, traits` (optional `pot`, `stars` 0-5, `side` L/R/C) |
| `coaches.csv`, `sides.csv`, `crests.csv` | real coaches, full-backs' sides, crest image links |
| `competitions.json` | formats, promotion and relegation, qualification |

`traits` takes up to two of `finalizacao, cabeceio, velocidade, drible, passe, marcacao, lideranca, reflexos, cobrancas`, separated by `|`. Squads under about 25 players are filled with generated players at the club's level. Run `npm run db` to rebuild `public/db/base.json`, or upload edited CSVs under "Novo jogo → Banco de dados personalizado" with no rebuild. `tools/fill-traits.ts` and `tools/fetch-crests.ts` fill in traits and crests.

The starter data comes from memory up to about mid-2026; ratings are approximate and may be outdated.

## Deploy

`npm run build` produces `dist/`, which runs from any static host and any subpath.

- **GitHub Pages:** Settings → Pages → Source: "GitHub Actions". `.github/workflows/deploy.yml` publishes every push to `main`.
- **Netlify / Cloudflare Pages:** build command `npm run build`, publish directory `dist`.

If a friend can't connect (some networks block direct WebRTC), add a TURN server under Início → Avançado in every browser in the session.

## Development

```bash
npm test            # engine and translation tests
npm run typecheck
```

Balance tools (`npx tsx tools/<name>.ts`):

| Tool | What it checks |
|---|---|
| `career.ts 5 seed --mix --active` | Four human clubs over several seasons: results, board, money, market, news, how the world evolves, and `BUG` lines for broken invariants. Run ten seeds side by side |
| `skill.ts 2000` | The manager ladder: a poor, a passive, the AI and a good manager on similar squads. Points per game must rise in that order |
| `calib.ts` | Match statistics: goals, xG, shots, home and away rates |
| `sensitivity.ts` | How much each engine input changes points per game |
| `leaguebalance.ts` | Whether the strongest squads still finish on top |
| `finsim.ts 5` | Club finances per league over several seasons |
| `marketsim.ts`, `pacing.ts 5` | Transfer-market activity; how live matches spend their time |
| `i18n-extract.ts` | Portuguese texts without an English entry |

The English lives in `src/i18n/en-*.ts`, keyed by the Portuguese text with `{0}`, `{1}`… for names and numbers; the page is translated as React draws it, so the game state, saves and network messages stay in Portuguese.

Layout: `src/engine/` is the pure game logic (match engine, competitions, economy, board, transfers, saves), `src/net/` the host, client replica and PeerJS transport, `src/ui/` the React screens.
