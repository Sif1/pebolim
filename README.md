# Pebolim Manager

A browser football-manager game for playing with friends. One player hosts from their browser; friends join with a 6-letter room code (peer-to-peer, no server). The game is in Portuguese (BR) or English: switch with the PT / EN buttons on the home screen or at the bottom of the menu (each player picks their own language). The home screen also lists what's new in each version.

- Brazil Série A, B and C, Copa do Brasil and 10 state championships
- Big 5 European leagues (two divisions each) with their domestic cups
- Argentina and Uruguay (two divisions each)
- Libertadores, Sul-Americana, Champions League and Europa League
- Live 2D match day: every human match on screen at once, each with its own clock; you pause and change only your own match
  - Championship Manager-style highlights: the pitch comes alive a few seconds before each chance and plays it at about real speed, then sits idle with the clock and commentary running; short matches show only the shots that matter most (goals always)
  - Live stats beside the pitch (possession, shots, xG, clear-cut chances, passes, tackles, saves) and a rating for every player next to their energy
  - Drag a substitute onto a player to bring him on, or drag players to new positions mid-match
- AI coaches that plan each match (favourite or underdog, home or away, knockout aggregate, what you usually play) and react live to the score, the clock, red cards and your tactics, with every change shown in the match feed
- Line-ups on a drawn pitch: drag players between the field, bench and reserves, and drag them to any of 25 positions (the role follows the area of the pitch)
- Matches last 1, 2, 3, 5 or 8 real minutes; the host can change it at any time under Opções
- Penalty shootouts you play: pick your five takers, then choose the corner for each kick and the side your keeper dives, with a pixel-art run-up and shot. Penalties during a match work the same way: pick the taker, then the corner
- Match sounds (Web Audio, no files): whistles for cards, penalties, half-time and full time; the crowd cheers a home goal and boos an away goal. Mute with the 🔊 button on match day
- Opponent scouting report on the dashboard: their likely shape and style, form, key players, absentees, energy and tips
- Youth team (Elenco → Base): rename your juniors and follow their age, potential stars and youth-match stats; their força shows only after promotion
- Mid-season board meetings, written warnings before a sacking, and a fan mood that fills or empties the stadium
- Pre-contracts: sign a player in the last six months of his contract for free, to join when it ends
- Transfer market with search filters (position, age, força, potential, trait, nationality with flags, for sale / for loan / in auction), sortable columns, bids between humans and the AI
  - Put your players up for sale at your price, offer them on loan for 6 or 12 months (the borrower pays the wages), or auction them: sealed bids from every manager and the AI, decided at the next round. The AI lists, loans and auctions its surplus players too, and buys listed players when the price is fair
- Players have potential (0–5 stars: how far and how fast they grow, how slowly they decline) and traits (finalização, cabeceio, drible, passe…) that matter in the match engine
- Contracts, finances in US$ with a wage-budget gauge, ticket prices per stadium sector and per competition, stadium expansion and training-centre works that take several rounds, travel logistics, injuries, suspensions, player development, youth intake, board firing and job offers
- Monthly awards in every country (player, young player and manager of the month), plus hat-tricks, goal milestones and streaks in the news
- Saves are small `.pebolim` files (about 450 KB) that anyone in the session can download

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. "Novo jogo" creates a career; keep "Abrir sala online" ticked to get a room code for friends.

For friends on other networks, deploy it (see below) so everyone opens the same public URL.

## How a session works

1. The host creates or loads a game. Friends enter the room code and type a name; there are no accounts.
2. Team pick:
   - **New game:** pick any club, or create your own. A custom club replaces a club you choose in that country's bottom division.
   - **Loaded game:** resume one of the career's managers, or start a new manager with any club that has no manager, or create your own club. Clubs whose managers are away stay reserved for them.
3. Between rounds everyone works on their own screen. Each manager clicks **Pronto** (not possible while an injured or suspended player is in their line-up), then the host clicks **Continuar**.
4. On match day, every human match is shown live. When all of them end, the host clicks **Ver resultados** to move to the round summary. Players put up for auction by other clubs show up after each match day.
5. Anyone can click **Baixar save** at any time. Everyone's browser also autosaves (Início → Carregar jogo → Continuar último jogo). If the host leaves, any player can host again from their copy.

How state stays consistent: the host is authoritative. Your clicks are sent to the host as commands; the host validates and applies them, then broadcasts small patches (or a full compressed snapshot after each match day) to everyone. Other managers' searches and drafts never leave their browser.

The host checks the shape of every message (types, number ranges, list sizes) before it reaches the game rules, rate-limits each player, and allows at most one full resync every 3 seconds per player, so a modified client can't inject invalid values or flood the host. Live matches run on a background-safe timer, but keep the host's tab open during match days.

## Editing the database

Clubs and players live in `data/db/*.csv`. They are meant to be edited in any spreadsheet app.

- `clubs-*.csv` columns: `key, name, short, country, state, city, lat, lon, color1, color2, stadium, capacity, rep, league, estadual, continent, contonly`
- `players-*.csv` columns: `club, name, pos (GOL/LAT/ZAG/VOL/MEI/ATA), birth, str (1-99), nat, traits`, plus optional `pot` (the força he can reach) and `stars` (0-5). Use the name the player is known by (Arrascaeta, Gabigol, Bruno Henrique); `src/engine/renames.ts` lists the renames so older saves pick them up too.
  - `traits` takes up to two of `finalizacao, cabeceio, velocidade, drible, passe, marcacao, lideranca, reflexos, cobrancas`, separated by `|`; `-` means none. Known players carry their real strengths; `npx tsx tools/fill-traits.ts` fills any blank cell with traits that fit the position and level (the same ones in every new game).
- `crests.csv` columns: `key, crest, wiki, title`: one crest image link per club, found on Wikipedia by `npx tsx tools/fetch-crests.ts` (the game links to the images; none are stored in the repository). To fix a wrong crest, paste another image link in the `crest` column, or add the club's exact article to `TITLES` in the tool and run it with `--only=key`.
- `competitions.json` holds the formats, promotion and relegation rules, and qualification rules.

Any squad with fewer than about 25 players is filled with generated players at the club's level.

```bash
npm run db
```

That rebuilds `public/db/base.json`. Alternatively, upload edited `clubs.csv` and `players.csv` in "Novo jogo → Banco de dados personalizado", with no rebuild needed.

The starter data (squads and ratings) comes from memory up to about mid-2026. It is approximate and may be outdated.

## Deploy (free static hosting)

```bash
npm run build
```

That produces `dist/`, which runs from any static host and any subpath.

- **GitHub Pages:** push to GitHub, then go to Settings → Pages → Source and choose "GitHub Actions". The included workflow `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
- **Netlify / Cloudflare Pages:** build command `npm run build`, publish directory `dist`.

If a friend can't connect (some mobile or corporate networks block direct WebRTC), add a TURN server. Go to Início → Avançado: servidor TURN, paste the server list, and do this in every browser in the session.

## Development

```bash
npm test
```

Engine tests: fixtures, a full season, knockouts, commands, patch replication and the save round-trip.

```bash
npm run sim -- 2
```

Plays two headless seasons and prints champions, finances and the save-file size.

```bash
npx tsx tools/calib.ts
```

Prints match-engine statistics (goals, xG, shots, passes, tackles, ratings, home/away rates).

```bash
npx tsx tools/sensitivity.ts
```

Measures how much each engine input (strength, sectors, fitness, morale, tactics, formations, traits…) changes points per game against the AI coach. [docs/ENGINE.md](docs/ENGINE.md) explains the engine and the AI coach and ranks these factors.

```bash
npx tsx tools/leaguebalance.ts
```

Plays three full seasons and checks that the strongest squads still finish on top (add `off` to compare without the AI coach).

```bash
npx tsx tools/skill.ts 2000
```

The manager ladder: real squads of similar strength managed by a poor, a passive, the AI and a good manager. Points per game must rise in that order (a good human beats the AI coach; a careless one does worse).

```bash
npx tsx tools/finsim.ts 3
npx tsx tools/marketsim.ts
npx tsx tools/pacing.ts 5
npx tsx tools/career.ts 4
```

Economy and match-day checks: three seasons of club balances per league (who is in the red, wages against income, where the money comes from); one season of the transfer market (AI listings, loans, auctions, and whether a human's fairly priced player sells); how live matches of a given length spend their time (highlights shown, their speed, the idle clock); and a career from the managers' side (four human clubs over several seasons: results, board patience, money, squad strength, bids, market opportunities, news, and how the world's champions and player strength evolve).

```bash
npx tsx tools/i18n-extract.ts
```

Lists the Portuguese texts in the source that have no English entry yet (`--all` lists every text). The English lives in `src/i18n/en-*.ts`, keyed by the Portuguese text with `{0}`, `{1}`… for names and numbers. In English the page is translated as React draws it (`src/i18n/index.ts`), so the game state, the saves and the network messages stay in Portuguese; text drawn on a canvas goes through `tr()`.

```bash
npm run typecheck
```

Project layout:

- `src/engine/` is the pure game logic (match engine, competitions, economy, board, transfers, save format).
- `src/net/` holds the host, the client replica, the PeerJS transport and the message protocol.
- `src/ui/` holds the React screens.
