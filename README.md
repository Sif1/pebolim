# Pebolim Manager

A browser football-manager game for playing with friends. One player hosts from their browser; friends join with a 6-letter room code (peer-to-peer, no server). The whole game is in Portuguese (BR).

- Brazil Série A, B and C, Copa do Brasil and 10 state championships
- Big 5 European leagues (two divisions each) with their domestic cups
- Argentina and Uruguay (two divisions each)
- Libertadores, Sul-Americana, Champions League and Europa League
- Live 2D match day: every human match on screen at once, each with its own clock; you pause and change only your own match
- Transfer market search, bids between humans and the AI, contracts, finances, stadium, training centre, travel logistics, injuries, suspensions, player development, youth intake, board firing and job offers
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
   - **Loaded game:** resume one of the career's managers, or take a club that was left without a manager (after a firing, a resignation or a move).
3. Between rounds everyone works on their own screen. Each manager clicks **Pronto**, then the host clicks **Jogar rodada**.
4. On match day, every human match is shown live. When all of them end, the host clicks **Ver resultados** to move to the round summary.
5. Anyone can click **Baixar save** at any time. Everyone's browser also autosaves (Início → Carregar jogo → Continuar último jogo). If the host leaves, any player can host again from their copy.

How state stays consistent: the host is authoritative. Your clicks are sent to the host as commands; the host validates and applies them, then broadcasts small patches (or a full compressed snapshot after each match day) to everyone. Other managers' searches and drafts never leave their browser.

## Editing the database

Clubs and players live in `data/db/*.csv`. They are meant to be edited in any spreadsheet app.

- `clubs-*.csv` columns: `key, name, short, country, state, city, lat, lon, color1, color2, stadium, capacity, rep, league, estadual, continent, contonly`
- `players-*.csv` columns: `club, name, pos (GOL/LAT/ZAG/VOL/MEI/ATA), birth, str (1-99), nat, traits (separated by |)`
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

Prints match-engine statistics (goals, shots, home/away rates).

```bash
npm run typecheck
```

Project layout:

- `src/engine/` is the pure game logic (match engine, competitions, economy, board, transfers, save format).
- `src/net/` holds the host, the client replica, the PeerJS transport and the message protocol.
- `src/ui/` holds the React screens.
