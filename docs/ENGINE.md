# How the match engine works

This is a guide to `src/engine/match/` (the simulation) and to what feeds it from the rest of the game. Every number here comes from the code; the ranking at the end was measured with `npx tsx tools/sensitivity.ts`.

The same engine plays every match. Matches you watch run it in real time and the 2D pitch only animates what it decides; background matches run it at full speed (about 1 ms per match). So watching a match never changes the odds.

## 1. The loop: one possession action at a time

A match is a chain of **actions**: pass, back pass, dribble, long ball, cross, shot, header, and the restarts (kick-off, goal kick, throw-in, corner, free kick, penalty). Each action lasts a few game seconds (a pass 2.5–5 s, a corner about 20 s). Its outcome is decided when it starts and applied when it ends. A match has about 1,500 actions.

The ball's position is tracked as **progress** (0 = own goal line, 1 = opponent's goal line) plus its height across the pitch. Where the ball is decides which players are involved and what the side in possession tends to do.

## 2. Team strength: four sector ratings

Every player in a slot gets an **effective strength**:

```
effective = força × form × position fit × fitness factor × morale factor
fitness factor = 0.70 + 0.30 × energy/100 − 0.6 × max(0, 0.80 − energy/100)
                 (100% → 1.00, 80% → 0.94, 70% → 0.85, 60% → 0.76)
morale factor  = 0.95 + 0.10 × morale/100      (morale 25 → 0.975, 95 → 1.045)
```

Below 80% energy every point costs three times as much (`FATIGUE` in `ratings.ts`), so a tired player really drops off, and fresh legs from the bench are worth having.

**Form on the day**: before kick-off every player draws a form factor around 1.0 (standard deviation 7%, `formSd`). Nobody sees it, but it shows in his match rating as the game goes, so a manager who watches the ratings can take off a player having a bad day.

**Position fit** is 1.0 in the player's own position. Neighbouring roles cost 10–20% (for example ZAG as LAT ×0.88, MEI as ATA ×0.86), unrelated roles ×0.70, an outfield player in goal ×0.30.

The slots are then combined into four **sector ratings**. Each slot's role feeds the sectors with these weights (every row sums to 1, so a formation decides where its strength goes, not how much there is):

| Role | Defence | Midfield | Attack |
|---|---|---|---|
| ZAG | 0.91 | 0.09 | – |
| LAT | 0.61 | 0.26 | 0.13 |
| VOL | 0.38 | 0.62 | – |
| MEI | – | 0.67 | 0.33 |
| ATA | – | 0.13 | 0.87 |

The keeper alone is the **GK** rating (×1.04 with the *reflexos* trait). Each sector is a weighted average of its players. A missing player (red card, injury with no subs left) counts as zero and the sector also loses up to 40% for being short-handed, so playing with ten hurts a lot.

Then the **tactics**:
- *Postura ofensiva*: attack ×1.07, defence ×0.93. *Defensiva*: defence ×1.06, attack ×0.92.
- *Pressão alta*: midfield ×1.03 (it also costs energy and cards, see below).
- A player with *liderança* on the pitch lifts defence, midfield and attack by 1.5%.

**Custom positions.** Your 10 outfield players can stand on any of 25 spots (5 lines × 5 lanes). The spot sets the role: back line = ZAG in the middle, LAT on the flanks; second line = VOL in the middle, LAT (wing-back) on the flanks; the next two lines = MEI; the front line = ATA. The engine only sees roles and coordinates, so a shape changes the sector weights above and who receives passes where; it does not model space or width.

## 3. Duels: who wins each action

Every action compares the side on the ball with the side defending, using a sector mix that depends on where the ball is:

| Ball in… | Attacking side uses | Defending side uses |
|---|---|---|
| own third | 60% defence + 40% midfield | 60% attack + 40% midfield |
| middle third | 55% midfield + 45% attack | 55% midfield + 45% defence |
| final third | 65% attack + 35% midfield | 70% defence + 30% midfield |

The home side's number is multiplied by **1.055** (`HOME_ADV`). The duel result is

```
r = A^2.55 / (A^2.55 + D^2.55)
```

so equal teams give 0.5, and the exponent (`duelExp`, 2.55) sets how decisive strength gaps are (75 vs 70 gives 0.544, 80 vs 70 gives 0.584). Small edges on each of ~1,500 actions add up over a match.

**The player on the ball matters too**: passes and long balls get + 0.8 × (his effective strength ÷ his team's average − 1), dribbles 1.5 times that (`indiv`). A star (or a player in form) beats his man more often than his sector rating alone would say.

The side on the ball picks an action. **Style** sets the mix (`STYLE_TUNE` in `core.ts`):

| Style | Pass | Back pass | Dribble | Long ball | Extra |
|---|---|---|---|---|---|
| Toque de bola | 60% | 14% | 16% | 10% | passes +0.06 more accurate |
| Contra-ataque | 48% | 22% | 15% | 15% | first 2 actions after winning the ball: long balls ×2, dribbles ×1.4, back passes ×0.2 |
| Bola longa | 36% | 20% | 10% | 34% | |

Success chances:
- **Pass** 0.63 + (r − 0.5) × 0.4 (+0.06 for toque, +0.04 with *passe*, −0.03 against *pressão alta*)
- **Back pass** 0.93
- **Dribble** 0.48 + (r − 0.5) × 0.5 (+0.08 *drible*, +0.04 *velocidade*)
- **Long ball** 0.365 + (r′ − 0.5) × 0.5, where r′ is the duel **where the ball lands** (so long balls into a strong defence fail more), +0.03 with *passe*

The three styles were tuned so that none beats the others at equal strength (each within ±0.02 points per game of toque; see the table in section 9). Before this, bola longa was worth +0.72 points per game, more than +10 força for the whole team.

A failed action is a foul (7%, or 9% against pressing) that keeps the ball with a free kick, the ball going out (15%), or an interception. A dribble lost to a defender is a **tackle** (*desarme*).

**Penalties**: defenders are careful in their own box, so fouls there are far rarer: 18% of the normal rate when someone dribbles at them, 6% otherwise (`boxFoulDribble`, `boxFoulOther`). Every foul in the box is a penalty. That gives about 0.30 penalties a match, as in real leagues. (Until this was fixed, half of every box foul became a penalty: 1.6 a match, nearly half of all goals.)

**Matchups** (`counterSpace`, `longVsPress`, `blockBig` in `STYLE_TUNE`) make tactics a choice against the opponent, not just a setting:
- **Contra-ataque against postura ofensiva**: the break lasts one action longer and passes, dribbles and long balls on the break are 0.03 more likely to work (space behind a team that pushed up).
- **Bola longa against pressão alta**: long balls are 0.03 more likely to work (they skip the press).
- **Against postura defensiva** the box is crowded: clear-cut chances are 30% rarer.

## 4. Chances, shots and goals

Shots come from:
- **Open play in the box** (progress above 0.84): 9.5% of actions. *Postura ofensiva* shoots ×1.3 more, *defensiva* ×0.75; against a side sitting deep you shoot ×0.85 (blocked lanes), against one pushing up ×1.05.
- **Edge of the box**: 2% of actions.
- **Easing off**: three goals up, a team takes fewer shots, ×0.6 for every goal of lead beyond two (`comfort`). Without it big mismatches ran up 8–10 goals; now a side scores 6+ in about 1% of league games and 8+ in 0.1%, close to real football.
- **Crosses** from the wide final third (40% of those situations): a header with chance 0.18 + (r − 0.5) × 0.3.
- **Corners**: a header 26% of the time (± duel), a short corner 15%.
- **Free kicks** within range: 38% direct shots, 30% headers.

The shooter is picked by position (ATA 5, MEI 2.6, VOL 0.9, LAT 0.6, ZAG 0.35) × 1.5 with *finalização* × (força/70)². Headers favour ATA and ZAG and *cabeceio* doubles a player's weight. Set pieces go to the *cobranças* player.

Every shot first gets a **chance quality**, its xG, which depends only on the situation:

| Shot | xG |
|---|---|
| In the box | usually 0.023–0.090; 9% are clear-cut chances at 0.35–0.63 |
| Header | usually 0.025–0.075; 6% are clear-cut at 0.31–0.56 |
| From distance | 0.013–0.040 |
| Direct free kick | 0.038–0.075 |
| Penalty | 0.76 (always a clear-cut chance) |

All but penalties are multiplied by `xgScale` (1.22), the main knob for goals per match. Shots average about 0.08 xG, close to real football. Posture also changes how open the game is: against *postura ofensiva* the opponent's clear-cut chances come ×1.3 more often (space behind), against *defensiva* ×0.7 (a crowded box).

The chance of scoring is the xG scaled by the people involved:

```
P(goal) = xG × (shooter effective / keeper rating)^0.8     (finishExp)
              × (attack / defence)^0.4                       (attDefExp; box shots and headers only)
              × 1.055^0.5 at home                            (homeShotExp)    clamped to 1%–90%
```

So a better finisher beats his xG and a better keeper drags it down. A shot that doesn't score is on target 36% of the time (saved; 45% of saves go out for a corner); otherwise box shots are blocked 28% of the time (half of those go out for a corner).

## 5. During the match: energy, injuries, cards, substitutions

- **Energy** drops 0.3 per minute (`drain`), ×1.15 for players 32 and older, ×0.95 for 21 and younger, ×1.25 with *pressão alta*, ×0.95 with *contra-ataque*. Half-time gives +6. A starter typically ends a match around 70%, where the fatigue curve starts to bite.
- **After the match** only 35% of that loss is still there at the next round (`fatiguePersist`; the rest is "match legs"), so tiredness matters inside a match without snowballing over a season.
- **Injuries**: 0.011% per player per minute, ×1.8 below 55% energy. 55% last 1–3 rounds, 33% 4–9, 12% 10–30. The engine subs the player automatically if it can.
- **Cards**: each foul is a yellow 17% of the time (21% when pressing, ×0.85 with *marcação*, ×0.3 if already booked) and a straight red 0.3%. Two yellows are a red.
- **Tired players**: AI sides replace their most tired outfield player below 66% (`aiSubAt`) from the 55th minute, at most one every 7 minutes, keeping one substitution for injuries until the 80th.

**Penalty shootouts** (`shootout.ts`). Five each, then sudden death, stopping as soon as one side can't catch up. Each kick goes left, middle or right and the keeper dives left, right or stays:
- The taker misses the target 2–16% of the time (better takers and *cobranças* specialists less; down the middle about half as often).
- If the keeper guesses the corner he saves 30–72% (keeper rating against taker); staying in the middle against a shot down the middle saves 72%. Guessing wrong saves 1–10% (reflexes).
- AI takers go for a corner 86% of the time; AI keepers dive to a corner, but notice takers who keep shooting down the middle and start staying put against them.

That converts about 74% of kicks, as in real shootouts. In a match with a human the shootout is played kick by kick: each manager picks five takers in order (30 s), then for every kick the taker's corner or the keeper's dive (10 s each; the AI chooses when time runs out or for an AI side), and the screen shows the run-up, the shot and the dive in pixel art. "Simular rápido" finishes it with AI choices.

## 6. The AI coach

Every AI club, and a human club whose manager drops out mid-match, is run by the coach in `src/engine/ai/tactics.ts` (`aiPlan`). It has two jobs.

**Before kick-off** (`aiPreMatchTactics` in `matchday.ts`) it works out the **strength edge**: its squad rating minus the opponent's, both scaled by how fresh the best 14 players are, ±2 for playing at home or away. It also checks a knockout aggregate it has to chase or protect, the style its own players suit (aerial strikers → bola longa, pace and dribblers → contra-ataque, passers → toque de bola), and what the opponent is likely to do (a human's saved tactics, or an AI club's natural style). Then:

| Situation | Plan |
|---|---|
| Favourite (edge ≥ 3) | equilibrada, its natural style (toque if that would be contra): keeps its shape and controls the game |
| Underdog (edge ≤ −3) | postura defensiva |
| Underdog at home, not hopeless (edge > −6) | equilibrada instead: doesn't hide at home |
| Opponent plays contra-ataque | never ofensiva (would feed the counters) |
| Opponent plays bola longa | never presses (the press is bypassed) |
| Opponent presses and it plays toque | switches to bola longa |
| Opponent is ofensiva | contra-ataque to use the space |

Favourites used to attack all-out from the start; measured against an opponent that adapts, that lost points to counter-attacks, so the opening plan is now calmer. It then picks the formation that suits the squad best, nudged toward 4-3-3 / 4-2-3-1 when attacking or 4-5-1 / 5-3-2 when defending if that costs little.

**During the match** it re-reads the game at the 15th, 30th, 45th, 60th, 75th and 85th minute (`AI_REVIEW_AT`), like a manager on the touchline: it does not react to a goal the moment it happens, which gives an attentive human the chance to be quicker. A red card is the exception: it reorganises at once.

| Situation | Change |
|---|---|
| Losing after 65' (55' if by 2+, 45' if it was the favourite) | ofensiva; bola longa against a defensive block |
| Losing after 80' | ofensiva, bola longa, pressing (if legs allow) |
| Losing after 70' | once per match, a more attacking formation plus a striker for a holding midfielder or defender |
| Winning by 2+ after 60' | calms down: equilibrada, no pressing |
| Winning by 1 after 75' (60' as underdog, 50' with ten men) | defensiva, contra-ataque |
| Winning after 78' | once per match, a more defensive formation plus a defender or holding midfielder for a striker |
| Drawing after 70' | favourite or home side pushes (ofensiva); underdog away settles for the draw |
| Knockout that must be decided, level after 60' | ofensiva |
| A man up | ofensiva, toque de bola, pressing from half-time (if legs allow) |
| A man down | defensiva, contra-ataque, and **reorganises** at once: the most advanced player drops into the hole, or a bench defender comes on for him |

Each change shows in the match feed with its reason, for example "Botafogo muda: bola longa, pressão alta (perdendo no fim, abafa)".

The AI never presses as its default plan. Pressing for 90 minutes costs 25% more energy and gives away more fouls, and over a season of congested fixtures that wore down the strong clubs (`tools/leaguebalance.ts` showed the link between squad strength and final position dropping from 0.66 to 0.42). It only presses in bursts: a man up, or chasing a game late. With that, league tables stay realistic: over three seasons the rank correlation between squad strength and final position is 0.71, and the champion came from the three strongest squads in 17 of 21 leagues.

## 6b. How much the manager matters

`tools/skill.ts` plays real squads within 4 força points of each other, half at home, against the AI coach, with four kinds of manager on one side (1,500 matches each, same fixtures and seeds):

| Manager | Points per game | Goal difference |
|---|---:|---:|
| Poor: 3-4-3, attacks and presses all match, never substitutes | 0.89 | −0.91 |
| Passive: 4-4-2, never touches anything | 1.32 | −0.07 |
| The AI coach | 1.31 | −0.07 |
| Good: reads the opponent before kick-off, uses half-time and at most 3 pauses (after a goal or a red card, else around 62' and 75'), fresh legs, takes off players having a bad day | 1.42 | +0.09 |

So a careless manager does much worse than the AI would, and an attentive one clearly better (+0.11 points per game, about +1.4 força for the whole team): the edge comes from tempo (posture at the right moment), substitutions before the fatigue curve bites, and spotting a player's bad day in his rating. A sensible manager who never touches anything is about as good as the AI. The ladder is the test for any change to the engine or the AI: it must stay in this order (each row is accurate to about ±0.03).

## 7. Player ratings

Everyone starts at 6.0. Then:

| Event | Change |
|---|---|
| Goal / penalty goal | +1.0 / +0.6 |
| Assist | +0.6 |
| Shot on target / off target | +0.12 / −0.04 |
| Missing a clear-cut chance | −0.3 extra |
| Save / saving a clear-cut chance | +0.25 / +0.5 |
| Completed pass / back pass / long ball / cross to a header | +0.012 / +0.004 / +0.03 / +0.06 |
| Failed pass | −0.06 |
| Dribble won / lost | +0.07 / −0.05 |
| Tackle / interception | +0.12 / +0.06 |
| Foul / yellow / red | −0.06 / −0.3 / −1.2 |
| Goal conceded (on the pitch) | keeper −0.3, ZAG/LAT −0.15, others −0.04 |
| Team scores (on the pitch) | +0.05 |

Ratings are clamped to 3.0–10.0. In calibration they average about 6.6, the man of the match is usually 8–8.5, and the season average is stored for every player.

**Penalties during a match** use the same model: a foul in the box gives a penalty (“Pênalti para o …”), and when a human side is involved the match stops for it. The manager taking it picks the taker (15 s) and both sides choose the corner and the dive as in a shootout, with the run-up shown as a highlight. AI sides, "Simular rápido" and an expired clock pick automatically.

**Live commentary.** Every live frame carries the action on screen (`LiveAction` in `live.ts`: kind, side, actor, target, how far up the pitch, and for a shot how it ends: goal, save, wide or blocked, known when the shot starts). The match screen (`ui/match/Commentary.tsx`) turns it into one line at a time, held about a second each and never more than three lines behind: every move during a highlight, only the shots while the clock runs fast, and a short line on who is on top every few seconds in between. The pressure bar is a smoothed reading of the side on the ball and how close it is to goal. Half-time and full time add a summary line from the frame's stats (a side with 4 more shots or 0.6 more xG "was better"); in a derby the first kick-off and every third filler line are derby lines. On the focused match the same reading drives the crowd noise (`crowdBed` in `ui/sound.ts`): a murmur that grows with the pressure (more when the home side presses), a roar at a chance or a goal, quiet while paused.

**Momentum** (the graph under the pitch): every minute each side collects pressure from time on the ball in the attacking third (up to 1 per action beyond 60% of the pitch), shots (1.5 + 6 × xG, +1 for a clear-cut chance), corners (0.8) and goals (3). The graph smooths it over three minutes; stoppage time folds into minutes 45 and 90.

## 8. Between matches: what feeds the engine

- **Energy recovery** per round: +8 × training centre (×0.85 at level 1 up to ×1.20 at level 5) × training focus (*físico* ×1.2, *técnico* ×0.9), ×0.85 for players who just played (`REST` in `development.ts`). Injured players recover at half speed and never above 80%. A side with two matches a week starts its XI around 91–93% energy, one with a match a week around 96–98%, so a packed calendar asks for rotation.
- **Travel** (away side, before the match): bus loses up to 14 energy (1 + km/120), commercial flight up to 9 (2 + km/900), charter up to 3. Charters cost far more.
- **Morale**: +4 after a win, −4 after a loss, +3 for scorers; it drifts back toward 60 by 3% a round.
- **Development**: young players grow (about +4 a year at 20 and under, +2.2 to 23, +0.5 to 27), players over 30 decline, scaled by the training centre (×0.8 to ×1.3), focus and playing time. **Potential** is 0–5 stars: each star raises the força a player can reach (58, 66, 73, 79, 85, 91), speeds up growth while young (×0.7 with none up to ×1.45 with five) and slows the decline after 30 (×1.3 down to ×0.7). Growth slows down over the last 6 points below the ceiling, and from 80 up world class comes slowly for everyone (the growth is multiplied by (93 − força) / 13: ×0.6 at 85, ×0.25 at 89), so even the best prospects peak in their mid-twenties. Generated youngsters start from the club's **academy level**, its filler level compressed above 72 (a top European academy turns out prospects around 66 at 16, not first-team players), and a better training centre gives an academy more prospects with upside without making the rare +3 stars (a future world-class player, 3%) any more common. Over five seasons the top 100 players' average força stays within a few tenths of where it starts.
- **Youth team** (human clubs, `youth.ts`): 7 to 14 juniors aged 15–19 who play a youth match every weekend (games, goals, assists and rating are kept) and grow at 0.6 of a first-team player's playing-time factor. Their força stays hidden until they are promoted; at 20 they must be promoted or leave. Each season brings 2–4 new juniors (one more with a training centre at level 4 or 5).
- **Fans** (0–100): +2.5 for a win (+1.5 more against a stronger side, +1 more by three goals or more), −2.5 for a defeat (−1 more at home, −2 more by three goals or more), +4 for signing a player as good as the squad's best three, −5 for selling one of them; they drift back toward 58 by 1.5% a round. Below 30 they protest, above 80 they party (both make the news). Match-day interest is ×(1 + (fans − 60) × 0.4%), so a happy crowd fills the stadium. The board's confidence also drifts toward the fans' mood.
- **Board**: confidence moves 2.4 points per match against what the objective needs, with a 20-round grace period for a new manager. At the end of the season it judges the objective (from +25 for a title to −35 for a giant outside the top 8; a manager in his first season at the club, or one who won a trophy with it this season or in the two before, takes half of any penalty) and sacks below 20. It holds a meeting after rounds 30 and 55 (the objective, the league position, its verdict and the fans' mood) and sends a written warning below 30. Below 18 (after the grace period) the last warning is an **ultimatum**: at least a set number of points from the next 5 matches (85% of what the board expects against those opponents, between 3 and 10 points). It is settled as soon as the target is reached or can no longer be: met, the board's confidence goes back to at least 32; missed, the manager is sacked. A human manager is never sacked for results mid-season without one, and a new season clears it. Unemployed managers always get offers: from clubs near their reputation, or else from the lowest-reputation clubs without a manager.
- **Derbies** (`rivals.ts`): a list of famous rivalries plus the four best-known clubs (reputation 50+) of each city. A derby moves the board 1.5× and the fans twice as much (±2 more for a win or a defeat), and fills the stadium like a final. Every derby and every match of a human-managed club adds to a head-to-head record kept across seasons (`state.h2h`).
- **Player stature** (`statureGap` in `transfers.ts`): the reputation a player expects from a club is 40 + (força − 62) × 2.4 (at most 92), 3 less per year over 29, 6 less for a club of his own country; never more than his current club's reputation − 2, plus 6 for a player under 31 leaving a European club for South America. Up to 8 points short, he joins for 5% more wage per point; beyond that he refuses (bids, pre-contracts, auctions, and the AI's own signings).
- **AI squads**: free agents an AI club signs must be at most 4 above its strength (2 when the board fills a short squad at the season end) and happy to play there; the big European clubs fill gaps at their own level minus 6. When it buys, an AI club searches every smaller AI club in the world at that position, best first, for the three best players who would come, whom it can pay and whose club can spare them. At the end of a contract an AI club keeps a starter (one of its best 11) 92% of the time (85% over its wage budget); the rest of the squad as before. Letting the first team walk out on free transfers was what made the big European leagues lose about 1.5 força over five seasons.
- **Deadline day** (`deadlineDay` in `transfers.ts`): the last open date of a window. The round before it, AI clubs send late bids (up to two per human club, 5–20% more generous) that can only be answered on deadline day, and big clubs list a few stars; on the day the AI does up to 24 deals and the news rounds them up. Bids for players at clubs expire as the window closes.
- **Training centre**: the board pays 50% of the works when its confidence is 60 or more, 25% from 40.
- **Season review** (`review.ts`): written for every human manager at the season end, before anyone moves: league position against the objective, cup runs, record, biggest win, player of the season (average rating plus goals and assists, regulars only), top scorer, best signing (players who joined that season, 5+ games) and the league's team of the season (4-3-3, regulars with at least half the most games). Career records count every match of a human-managed club.
- **AI line-ups**: the best effective player for each slot, greedily, with a balanced bench.

## 9. What matters most (measured)

`tools/sensitivity.ts` plays 3,000 matches per scenario. Both teams are rated 70, play 4-4-2 with balanced tactics, and use the same seeds as the baseline; only one thing about the home team changes. The home team keeps its tactics all match, like a manager who never touches anything, against an opponent run by the AI coach. The table shows how the change moves the home team's **points per game** (baseline 1.65), goal difference per game and xG difference per game. Each row is accurate to about ±0.02 points per game.

| # | Group | Change to the home team | Δ points/game | Δ goal diff/game | Δ xG diff/game |
|---|---|---|---:|---:|---:|
| 1 | Condition | Energy 60% (instead of 95%) | −1.53 | −3.38 | −1.98 |
| 2 | Condition | Energy 75% | −1.05 | −1.72 | −1.08 |
| 3 | Line-up | Ten men from kick-off | −0.72 | −1.08 | −0.92 |
| 4 | Strength | Every player +10 força (70 → 80) | +0.69 | +1.14 | +0.68 |
| 5 | Venue | Playing away instead of at home | −0.66 | −1.00 | −0.79 |
| 6 | Strength | Every player −5 força | −0.43 | −0.65 | −0.42 |
| 7 | Condition | 1,000 km bus trip (−9 energy) | −0.40 | −0.63 | −0.41 |
| 8 | Strength | Every player +5 força (70 → 75) | +0.37 | +0.52 | +0.32 |
| 9 | Sectors | Midfield (VOL/MEI) +10 | +0.23 | +0.31 | +0.27 |
| 10 | Sectors | Strikers (ATA) +10 | +0.21 | +0.30 | +0.21 |
| 11 | Tactics | *Pressão alta* for 90 minutes | −0.19 | −0.29 | −0.16 |
| 12 | Condition | Morale 25 (instead of 60) | −0.19 | −0.31 | −0.21 |
| 13 | Sectors | Defenders (ZAG/LAT) +10 | +0.19 | +0.21 | +0.11 |
| 14 | Tactics | *Postura ofensiva* for 90 minutes | −0.18 | −0.27 | −0.23 |
| 15 | Condition | Morale 95 | +0.17 | +0.24 | +0.19 |
| 16 | Line-up | Three players out of position | −0.13 | −0.21 | −0.14 |
| 17 | Condition | Veteran squad (tires 15% faster) | −0.11 | −0.19 | −0.10 |
| 18 | Traits | One *liderança* player on the pitch | +0.09 | +0.11 | +0.07 |
| 19 | Sectors | Keeper +10 | +0.07 | +0.09 | +0.01 |
| 20 | Formation | 3-4-3 (against 4-4-2) | −0.07 | −0.08 | −0.16 |
| 21 | Traits | Midfielders with *passe* | +0.07 | +0.08 | +0.11 |
| 22 | Line-up | One striker playing centre-back | −0.06 | −0.12 | −0.03 |
| 23 | Formation | 4-5-1 | +0.05 | +0.06 | +0.06 |
| 24 | Formation | 3-5-2 | −0.05 | −0.09 | −0.07 |
| 25 | Traits | Defenders and strikers with *cabeceio* | +0.03 | +0.04 | 0.00 |
| 26 | Traits | Keeper with *reflexos* | +0.03 | +0.05 | 0.00 |
| 27 | Traits | Strikers with *finalização* | +0.03 | +0.04 | 0.00 |
| 28 | Traits | Midfielders and strikers with *drible* | +0.03 | +0.06 | +0.09 |
| 29 | Tactics | *Postura defensiva* for 90 minutes | −0.02 | −0.05 | 0.00 |
| 30 | Formation | 4-2-3-1 | +0.02 | 0.00 | +0.02 |
| 31 | Tactics | *Bola longa* (instead of toque) | −0.02 | −0.05 | −0.06 |
| 32 | Tactics | *Contra-ataque* (instead of toque) | −0.02 | −0.01 | −0.01 |
| 33 | Formation | 5-3-2 | +0.01 | −0.02 | −0.04 |
| 34 | Traits | Defenders with *marcação* | 0.00 | 0.00 | 0.00 |
| 35 | Formation | 4-3-3 | 0.00 | 0.00 | −0.02 |

Baseline: 1.65 points per game at home for a 70-rated team against a 70-rated team, +0.47 goal difference. For scale, the gap between a title team and a relegated one is about 1 point per game.

**In short**, from most to least important:
1. **Energy**. Below 80% the fatigue curve is steep: a whole team at 75% loses a point per game, a long bus trip (−9 energy) costs 0.4. Rotation, training focus, the training centre, travel and fresh legs from the bench are the manager's biggest levers.
2. **Squad quality** (força): five points are worth about 0.4 points per game.
3. **Home advantage** (a flat ×1.055 on every duel) and **playing a man down**: about 0.7 each.
4. **Sectors** are now close: +10 in midfield +0.23, attack +0.21, defence +0.19, keeper +0.07. Formations are within ±0.07 of 4-4-2.
5. **Tactics as tempo**: attacking or pressing for 90 minutes costs about 0.2 (energy, space behind); used at the right moments they are what separates a good manager from the AI (section 6b). The three styles are even (within ±0.02).
6. **Morale** about ±0.2 between the extremes; **traits** under 0.1 each.

## 10. Ideas for what to add or tweak

**Balance problems the measurements show**
- **Energy may now be too strong** (a team at 75% loses a point per game). It is what makes fresh legs and rotation worth managing, but if long trips decide too many matches, soften `FATIGUE.steep` in `ratings.ts` or the travel fatigue.
- **Pressing and attacking for 90 minutes only cost** (about −0.2): good in bursts, bad as a default. Ideas: pressing could lower the opponent's pass accuracy in their own half and win the ball higher up.
- **The AI coach's thresholds** (edge ±3, the minutes in section 6, the review times) are guesses that play sensibly. `tools/skill.ts` and `tools/leaguebalance.ts` check that the manager ladder and the league tables stay right after changing them.
- **Most traits are small**: *finalização*, *cabeceio*, *reflexos* and *drible* are worth 0.03 each, and *marcação* only lowers yellow cards. Ideas: *marcação* lowers opponents' dribble and pass success near the player; *finalização* raises the shooter factor more (now ×1.10); *reflexos* adds more than 4%.

**Realism**
- **Too many turnovers**: about 70% pass accuracy, 310 passes and 33 tackles per team, against roughly 80–85%, 450 and 17 in real football. Raising pass success and lowering dribble frequency would fix the stats, but shot and goal rates would need recalibrating (`tools/calib.ts`, then `tools/sensitivity.ts` to check the styles stay even).
- **Shots per team are a bit high** (about 17, against 12–14 real) and shots on target too (about 7, against 4–5).

**New inputs worth adding**
- **Home advantage** is a constant. It could grow with attendance (a full stadium), travel distance, altitude (La Paz, Quito) and derbies, which would also make ticket prices matter beyond money.
- **Player attributes**: one força number per player plus traits. Pace, technique, defending, aerial ability and stamina would make roles, custom positions and traits matter.
- **Space and width**: custom positions only change roles and pass targets. Leaving a flank empty has no cost beyond the sector weights.
- **Weather and pitch, referees** (card strictness), **team chemistry** (new signings, familiarity with a shape), **captaincy** (a *liderança* player as captain).

To try an idea: change the numbers in `STYLE_TUNE`, `core.ts` or `ratings.ts`, run `npx tsx tools/calib.ts` to keep goals near 2.75 per match and home wins near 46%, `npx tsx tools/sensitivity.ts` to see what moved, and `npx tsx tools/skill.ts` to check the manager ladder still holds (`tools/skill.ts 2000 '{"drain":0.25}'` tries a `STYLE_TUNE` value without editing the code).

