# Pebolim Manager

A browser football-manager game for playing with friends. One player hosts from their browser; friends join with a 6-letter room code (peer-to-peer, no server). Play it at **https://sif1.github.io/pebolim/**.

The game is in Portuguese (BR) or English: switch with the PT / EN buttons on the home screen or at the bottom of the menu (each player picks their own language). The home screen lists what's new in each version.

## Features

**The world**
- Brazil Série A, B and C, Copa do Brasil and 10 state championships
- Big 5 European leagues (two divisions each) with their domestic cups
- Argentina and Uruguay (two divisions each)
- Libertadores, Sul-Americana, Champions League and Europa League, with continental-only clubs from the rest of South America and Europe
- Real clubs and players, with crests; monthly awards in every country (player, young player and manager of the month), plus hat-tricks, goal milestones and streaks in the news

**Match day**
- Every human match on screen at once, each with its own clock; you pause and change only your own match
- Championship Manager-style highlights: the 2D pitch comes alive a few seconds before each chance and plays it at about real speed, then sits idle while the clock runs; short matches show only the shots that matter most (goals always)
- Live commentary under the pitch, the old CM way: one line at a time narrates the move on screen (the pass, the run, the cross, the shot and how it ends) on the colours of the team on the ball. A pressure bar tilts toward whoever is on top, a goal flashes the line and the scoreboard in the scorer's colours, and half-time and full time get a summary (score, possession, shots, xG, who was better)
- Derbies (clássicos): the famous rivalries (Fla-Flu, Gre-Nal, Boca v River, Real v Barça…) and the big clubs of each city. They are marked on the scoreboard, have their own commentary lines, fill the stadium, and count double for the fans and more for the board
- Momentum graph (minute by minute, in the teams' kits), live stats (possession, shots, xG, clear-cut chances, passes, tackles, saves) and a rating for every player next to his energy and strength
- Drag a substitute onto a player (or a starter onto the bench) to make a change, or drag players to new positions mid-match
- Penalty shootouts you play: pick your five takers, then choose the corner for each kick and the side your keeper dives, with a pixel-art run-up and shot. Penalties during a match work the same way: pick the taker, then the corner
- Match sounds (Web Audio, no files): whistles for cards, penalties, half-time and full time; a crowd murmur that swells with the pressure and roars at the chances; the crowd cheers a home goal and boos an away goal. Mute with the 🔊 button
- Matches last 1, 2, 3, 5 or 8 real minutes; the host can change it at any time under Opções

**Your club**
- Dashboard: next match with travel cost (and the head-to-head record, marked when it's a derby), an opponent scouting report (likely shape and style, form, key players, absentees, tips), the next fixtures, your part of the league table, the board and the fans
- A season review when the season ends: final position and objective, record, cup runs, biggest win, player of the season, top scorer, best signing, and the league's team of the season on a pitch. The manager screen keeps a trophy room and career numbers (matches, points won, goals, biggest win and heaviest defeat, derbies)
- Squad with summary chips (best-14 strength, average age, injured, suspended, tired, expiring contracts) and a youth team (Elenco → Base): rename your juniors and follow their age, potential stars and youth-match stats; their força shows only after promotion
- Line-ups on a drawn pitch: drag players between the field, bench and reserves, and to any of 25 positions (the role follows the area of the pitch)
- Attack focus (through the middle, down the flanks, or wherever the play goes): about 70% of the play goes through the chosen channel, and every duel there is that part of your team against the matching part of theirs, so it pays when it suits the line-up (strong wingers and full-backs and heading strikers for the flanks; strong midfielders and strikers for the middle). The line-up screen shows how strong each channel is
- Players have a preferred side: full-backs show as LE/LD, wide players carry an arrow, and anyone on his wrong flank plays a little worse (marked on the tactics board)
- Every stadium has a pitch condition that wears with each home match and recovers between rounds; choose its care in the stadium screen (basic saves money, premium recovers twice as fast). A poor pitch tires both teams more and makes passing a little harder, so long balls gain a little
- Named AI coaches (the real ones where known, see `coaches.csv`) that plan each match (favourite or underdog, home or away, knockout aggregate, what you usually play) and react live to the score, the clock, red cards and your tactics
- Contracts with automatic renewal (like Brasfoot's) that respects the wage budget, finances in US$, ticket prices per stadium sector and per competition, stadium expansion and training-centre works that take several rounds, travel logistics, injuries, suspensions and player development
- Players have potential (0–5 stars: how far and how fast they grow, how slowly they decline) and traits (finalização, cabeceio, drible, passe…) that matter in the match engine

**The market**
- Brasfoot-style search (position, age, força, potential, trait, nationality with flags, for sale / for loan / in auction / free / expiring, "within my budget"), sortable columns, bids between humans and the AI with expiry dates
- Put players up for sale at your price, offer them on loan for 6 or 12 months, or auction them: sealed bids from every manager and the AI, decided at the next round, with a history of past auctions. The AI lists, loans and auctions its surplus players too, and big AI clubs sometimes put a star up for sale
- Pre-contracts: sign a player in the last six months of his contract for free, to join when it ends
- A "vs. squad" column (força against your best in that position) and, on the player card, a side-by-side comparison with your starter
- Players have standards: a star refuses a club far below his level and asks for more from one a little below it; veterans happily go home. The player card warns you before you bid
- Transfer deadline day: the last round of each window is busier (twice the AI deals, stars put up for sale), late bids arrive that can only be answered that round, and the news rounds up the day's deals

**Board and fans**
- A season objective from the club's standing, board confidence that moves with every result, mid-season board meetings and written warnings before a sacking
- The last warning is an ultimatum with a clear target ("at least 6 points from the next 5 matches"), shown on the dashboard and in the notifications: meet it and the board trusts you again
- A manager in his first season at the club, or one who won a trophy with it in the last three seasons, takes half the blame for a missed objective
- Fan mood that fills or empties the stadium, lifted by wins and big signings, hurt by defeats and by selling stars (and twice as much by a derby)
- The board pays half of the training-centre works when it trusts the manager (a quarter when it's unsure)
- Sacked managers stay in the game and keep receiving job offers, mostly from the country they last worked in
- AI clubs sack their coaches too, and hire someone out of work or a new name
- A coaching ranking of every human and AI coach (Competições → Técnicos): wins and draws weighted by the competition and the league's level, titles, and the manager of the month and of the season awards; all-time and this season
- If the squad is short at the end of a season, the board only tops it up to 18 players with free agents at the club's level and within the wage budget, else local youngsters, and always keeps two goalkeepers

**The interface**
- A notification bell lists what needs your attention (bids to answer, the window closing, line-up problems, auctions worth a look, the board, a derby coming up), each a click from its screen; no pop-ups
- Keyboard shortcuts: Space continues the round (or gets you ready; pauses your match on match day), 1 to 9 open the menu screens, N the notifications, ? the list
- Continuing with a bid for one of your players still unanswered on its last round asks first, so it doesn't lapse by accident
- Tooltips explain força and potential stars wherever they appear
- Works on phones: the menu becomes a strip at the top and match day fits in one column

**Multiplayer and saves**
- Peer-to-peer rooms for up to 8 managers, host-authoritative with input checks
- Saves are small `.pebolim` files (about 450 KB) that anyone in the session can download; every browser also autosaves

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

- `clubs-*.csv` columns: `key, name, short, country, state, city, lat, lon, color1, color2, stadium, capacity, rep, league, estadual, continent, contonly`, plus optional `coach` and `coach_nat`
- `players-*.csv` columns: `club, name, pos (GOL/LAT/ZAG/VOL/MEI/ATA), birth, str (1-99), nat, traits`, plus optional `pot` (the força he can reach), `stars` (0-5) and `side` (L/E, R/D or C; when missing, full-backs alternate right and left and the others get one at random). Use the name the player is known by (Arrascaeta, Gabigol, Bruno Henrique); `src/engine/renames.ts` lists the renames so older saves pick them up too.
  - `traits` takes up to two of `finalizacao, cabeceio, velocidade, drible, passe, marcacao, lideranca, reflexos, cobrancas`, separated by `|`; `-` means none. Known players carry their real strengths; `npx tsx tools/fill-traits.ts` fills any blank cell with traits that fit the position and level (the same ones in every new game).
- `crests.csv` columns: `key, crest, wiki, title`: one crest image link per club, found on Wikipedia by `npx tsx tools/fetch-crests.ts` (the game links to the images; none are stored in the repository). To fix a wrong crest, paste another image link in the `crest` column, or add the club's exact article to `TITLES` in the tool and run it with `--only=key`.
- `coaches.csv` columns: `key, coach, nat`: the real coach of each club (the start of 2025/26 in Europe, late 2025 in South America; fix any that changed). Clubs left out get a made-up coach in each new game.
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

Engine tests: fixtures, a full season, knockouts, commands, patch replication, the save round-trip, live matches (highlights, penalties, the commentary feed), the board, the youth team, the season-end housekeeping, derbies and head-to-head records, player stature, deadline day, the season review, the training-centre share, the board's ultimatum, player development, the AI's contract renewals, coaches and the coaching ranking, flanks, the attack focus and pitch condition; plus the translation layer.

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
```

Economy and match-day checks: three seasons of club balances per league (who is in the red, wages against income, where the money comes from); one season of the transfer market (AI listings, loans, auctions, and whether a human's fairly priced player sells); and how live matches of a given length spend their time (highlights shown, their speed, the idle clock).

```bash
npx tsx tools/career.ts 5 run-1 --mix --active
```

A career from the managers' side: four human clubs over several seasons, with the results, board patience, money, squad strength, bids, market opportunities, how much needs the manager's attention each round, the news, and how the world's champions and player strength evolve. `--mix` draws the four clubs from the seed (a Brazilian top-6 side, a Série A side, a Série B/C side and a European side); `--active` makes the managers play the market (free agents, listed players, auctions, pre-contracts), run the youth team, invest in the training centre and take clearly bigger jobs. Every round the whole state is checked for broken rules (players at missing clubs, expired contracts, loans without a club, clubs without a goalkeeper, impossible tables…), printed as `BUG` lines. Run ten seeds side by side to cover a lot of ground.

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
