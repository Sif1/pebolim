# How the match engine works

This is a guide to `src/engine/match/` (the simulation) and to what feeds it from the rest of the game. Every number here comes from the code; the ranking at the end was measured with `npx tsx tools/sensitivity.ts`.

The same engine plays every match. Matches you watch run it in real time and the 2D pitch only animates what it decides; background matches run it at full speed (about 1 ms per match). So watching a match never changes the odds.

## 1. The loop: one possession action at a time

A match is a chain of **actions**: pass, back pass, dribble, long ball, cross, shot, header, and the restarts (kick-off, goal kick, throw-in, corner, free kick, penalty). Each action lasts a few game seconds (a pass 2.5–5 s, a corner about 20 s). Its outcome is decided when it starts and applied when it ends. A match has about 1,500 actions.

The ball's position is tracked as **progress** (0 = own goal line, 1 = opponent's goal line) plus its height across the pitch. Where the ball is decides which players are involved and what the side in possession tends to do.

## 2. Team strength: four sector ratings

Every player in a slot gets an **effective strength**:

```
effective = força × position fit × fitness factor × morale factor
fitness factor = 0.70 + 0.30 × energy/100      (100% → 1.00, 60% → 0.88)
morale factor  = 0.95 + 0.10 × morale/100      (morale 25 → 0.975, 95 → 1.045)
```

**Position fit** is 1.0 in the player's own position. Neighbouring roles cost 10–20% (for example ZAG as LAT ×0.88, MEI as ATA ×0.86), unrelated roles ×0.70, an outfield player in goal ×0.30.

The slots are then combined into four **sector ratings**. Each slot's role feeds the sectors with these weights:

| Role | Defence | Midfield | Attack |
|---|---|---|---|
| ZAG | 1.0 | 0.1 | – |
| LAT | 0.7 | 0.3 | 0.15 |
| VOL | 0.5 | 0.8 | – |
| MEI | – | 1.0 | 0.5 |
| ATA | – | 0.15 | 1.0 |

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
| middle third | midfield | midfield |
| final third | 65% attack + 35% midfield | 70% defence + 30% midfield |

The home side's number is multiplied by **1.07**. The duel result is

```
r = A^2.6 / (A^2.6 + D^2.6)
```

so equal teams give 0.5, and the exponent 2.6 sets how decisive strength gaps are (75 vs 70 gives 0.545, 80 vs 70 gives 0.586). Small edges on each of ~1,500 actions add up over a match.

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
- **Long ball** 0.335 + (r′ − 0.5) × 0.5, where r′ is the duel **where the ball lands** (so long balls into a strong defence fail more), +0.03 with *passe*

The three styles were tuned so that none beats the others at equal strength (each within ±0.03 points per game of toque; see the table in section 8). Before this, bola longa was worth +0.72 points per game, more than +10 força for the whole team.

A failed action is a foul (7%, or 9% against pressing) that keeps the ball with a free kick (a penalty half the time when it happens in the box), the ball going out (15%), or an interception. A dribble lost to a defender is a **tackle** (*desarme*).

**Matchups** (`counterSpace`, `longVsPress`, `blockBig` in `STYLE_TUNE`) make tactics a choice against the opponent, not just a setting:
- **Contra-ataque against postura ofensiva**: the break lasts one action longer and passes, dribbles and long balls on the break are 0.03 more likely to work (space behind a team that pushed up).
- **Bola longa against pressão alta**: long balls are 0.03 more likely to work (they skip the press).
- **Against postura defensiva** the box is crowded: clear-cut chances are 20% rarer.

## 4. Chances, shots and goals

Shots come from:
- **Open play in the box** (progress above 0.84): 9.5% of actions, ×1.15 with *postura ofensiva*, ×0.85 *defensiva*.
- **Edge of the box**: 2% of actions.
- **Crosses** from the wide final third (40% of those situations): a header with chance 0.18 + (r − 0.5) × 0.3.
- **Corners**: a header 26% of the time (± duel), a short corner 15%.
- **Free kicks** within range: 38% direct shots, 30% headers.

The shooter is picked by position (ATA 5, MEI 2.6, VOL 0.9, LAT 0.6, ZAG 0.35) × 1.5 with *finalização* × (força/70)². Headers favour ATA and ZAG and *cabeceio* doubles a player's weight. Set pieces go to the *cobranças* player.

Every shot first gets a **chance quality**, its xG, which depends only on the situation:

| Shot | xG |
|---|---|
| In the box | usually 0.012–0.050; 9% are clear-cut chances at 0.19–0.35 |
| Header | usually 0.014–0.041; 6% are clear-cut at 0.17–0.31 |
| From distance | 0.007–0.022 |
| Direct free kick | 0.021–0.041 |
| Penalty | 0.76 (always a clear-cut chance) |

All but penalties are multiplied by `xgScale` (0.69), the main knob for goals per match.

The chance of scoring is the xG scaled by the people involved:

```
P(goal) = xG × (shooter effective / keeper rating)^0.95
              × (attack / defence)^0.5      (box shots and headers only)
              × 1.07 at home                 (clamped to 1%–90%)
```

So a better finisher beats his xG and a better keeper drags it down. A shot that doesn't score is on target 36% of the time (saved; 45% of saves go out for a corner); otherwise box shots are blocked 28% of the time (half of those go out for a corner).

## 5. During the match: energy, injuries, cards, the AI

- **Energy** drops 0.13 per minute, ×1.15 for players 32 and older, ×0.95 for 21 and younger, ×1.25 with *pressão alta*, ×0.95 with *contra-ataque*. Half-time gives +4.
- **Injuries**: 0.011% per player per minute, ×1.8 below 55% energy. 55% last 1–3 rounds, 33% 4–9, 12% 10–30. The engine subs the player automatically if it can.
- **Cards**: each foul is a yellow 17% of the time (21% when pressing, ×0.85 with *marcação*, ×0.3 if already booked) and a straight red 0.3%. Two yellows are a red.
- **Tired players**: AI sides replace their most tired player (below 72%) from the 55th minute, at most one every 7 minutes, keeping one substitution for injuries until the 80th.

## 6. The AI coach

Every AI club, and a human club whose manager drops out mid-match, is run by the coach in `src/engine/ai/tactics.ts` (`aiPlan`). It has two jobs.

**Before kick-off** (`aiPreMatchTactics` in `matchday.ts`) it works out the **strength edge**: its squad rating minus the opponent's, both scaled by how fresh the best 14 players are, ±2 for playing at home or away. It also checks a knockout aggregate it has to chase or protect, the style its own players suit (aerial strikers → bola longa, pace and dribblers → contra-ataque, passers → toque de bola), and what the opponent is likely to do (a human's saved tactics, or an AI club's natural style). Then:

| Situation | Plan |
|---|---|
| Favourite (edge ≥ 3) | postura ofensiva, its natural style (toque if that would be contra) |
| Underdog (edge ≤ −3) | postura defensiva, contra-ataque |
| Underdog at home, not hopeless (edge > −6) | equilibrada instead: doesn't hide at home |
| Slightly weaker and away | equilibrada, contra-ataque |
| Opponent plays contra-ataque | never ofensiva (would feed the counters) |
| Opponent plays bola longa | never presses (the press is bypassed) |
| Opponent presses and it plays toque | switches to bola longa |
| Opponent is ofensiva | contra-ataque to use the space |

It then picks the formation that suits the squad best, nudged toward 4-3-3 / 4-2-3-1 when attacking or 4-5-1 / 5-3-2 when defending if that costs little.

**During the match** it re-reads the game every 5 minutes (at most one change every 10 minutes) and **at once after any goal or red card**:

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
| A man up | ofensiva, toque de bola, pressing from half-time |
| A man down | defensiva, contra-ataque, and **reorganises**: the most advanced player drops into the hole, or a bench defender comes on for him |

Each change shows in the match feed with its reason, for example "Botafogo muda: bola longa, pressão alta (perdendo no fim, abafa)".

The AI never presses as its default plan. Pressing for 90 minutes costs 25% more energy and gives away more fouls, and over a season of congested fixtures that wore down the strong clubs (`tools/leaguebalance.ts` showed the link between squad strength and final position dropping from 0.66 to 0.42). It only presses in bursts: a man up, or chasing a game late. With that, league tables with the AI coach match those without it (rank correlation 0.64 against 0.66, and the champion came from the three strongest squads in 17 of 21 leagues over three seasons).

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

## 8. Between matches: what feeds the engine

- **Energy recovery** per round: +12.5 × training centre (×0.85 at level 1 up to ×1.20 at level 5) × training focus (*físico* ×1.2, *técnico* ×0.9), ×0.85 for players who just played. Injured players recover at half speed and never above 80%.
- **Travel** (away side, before the match): bus loses up to 14 energy (1 + km/120), commercial flight up to 9 (2 + km/900), charter up to 3. Charters cost far more.
- **Morale**: +4 after a win, −4 after a loss, +3 for scorers; it drifts back toward 60 by 3% a round.
- **Development**: young players grow (about +4 a year at 20 and under, +2.5 to 23), players over 30 decline, scaled by the training centre (×0.8 to ×1.3), focus and playing time. Players at their hidden potential barely grow.
- **AI line-ups**: the best effective player for each slot, greedily, with a balanced bench.

## 9. What matters most (measured)

`tools/sensitivity.ts` plays 3,000 matches per scenario. Both teams are rated 70, play 4-4-2 with balanced tactics, and use the same seeds as the baseline; only one thing about the home team changes. The home team keeps its tactics all match, like a manager who never touches anything, against an opponent run by the AI coach. The table shows how the change moves the home team's **points per game** (baseline 1.69), goal difference per game and xG difference per game. Each row is accurate to about ±0.02 points per game.

| # | Group | Change to the home team | Δ points/game | Δ goal diff/game | Δ xG diff/game |
|---|---|---|---:|---:|---:|
| 1 | Condition | Energy 60% (instead of 95%) | −0.68 | −1.04 | −0.62 |
| 2 | Strength | Every player +10 força (70 → 80) | +0.67 | +1.10 | +0.65 |
| 3 | Venue | Playing away instead of at home | −0.65 | −0.93 | −0.72 |
| 4 | Line-up | Ten men from kick-off | −0.58 | −0.83 | −0.68 |
| 5 | Formation | 3-4-3 (against 4-4-2) | −0.51 | −0.72 | −0.70 |
| 6 | Strength | Every player −5 força | −0.44 | −0.67 | −0.42 |
| 7 | Strength | Every player +5 força (70 → 75) | +0.40 | +0.62 | +0.40 |
| 8 | Condition | Energy 75% | −0.39 | −0.57 | −0.35 |
| 9 | Sectors | Midfield (VOL/MEI) +10 | +0.33 | +0.53 | +0.41 |
| 10 | Formation | 4-3-3 (against 4-4-2) | −0.29 | −0.39 | −0.41 |
| 11 | Condition | Morale 95 (instead of 60) | +0.24 | +0.35 | +0.19 |
| 12 | Line-up | Three players out of position | −0.23 | −0.36 | −0.28 |
| 13 | Sectors | Strikers (ATA) +10 | +0.19 | +0.28 | +0.13 |
| 14 | Condition | 1,000 km bus trip (−9 energy) | −0.19 | −0.28 | −0.15 |
| 15 | Sectors | Defenders (ZAG/LAT) +10 | +0.19 | +0.28 | +0.17 |
| 16 | Condition | Morale 25 | −0.18 | −0.27 | −0.18 |
| 17 | Tactics | *Postura ofensiva* for 90 minutes | −0.14 | −0.21 | −0.20 |
| 18 | Formation | 4-5-1 | +0.12 | +0.15 | +0.15 |
| 19 | Sectors | Keeper +10 | +0.11 | +0.18 | +0.01 |
| 20 | Tactics | *Pressão alta* for 90 minutes | −0.10 | −0.13 | −0.12 |
| 21 | Traits | One *liderança* player on the pitch | +0.08 | +0.10 | +0.09 |
| 22 | Line-up | One striker playing centre-back | −0.07 | −0.14 | −0.06 |
| 23 | Traits | Midfielders and strikers with *drible* | +0.06 | +0.10 | +0.06 |
| 24 | Traits | Keeper with *reflexos* | +0.06 | +0.09 | +0.01 |
| 25 | Traits | Midfielders with *passe* | +0.06 | +0.11 | +0.12 |
| 26 | Formation | 5-3-2 | −0.05 | −0.10 | −0.11 |
| 27 | Formation | 4-2-3-1 | +0.04 | +0.07 | +0.09 |
| 28 | Tactics | *Bola longa* (instead of toque) | −0.04 | −0.05 | −0.10 |
| 29 | Condition | Veteran squad (tires 15% faster) | −0.03 | −0.05 | −0.05 |
| 30 | Traits | Strikers with *finalização* | +0.03 | +0.05 | +0.01 |
| 31 | Tactics | *Contra-ataque* (instead of toque) | +0.02 | +0.05 | +0.05 |
| 32 | Tactics | *Postura defensiva* for 90 minutes | +0.02 | 0.00 | +0.02 |
| 33 | Formation | 3-5-2 | −0.01 | 0.00 | −0.04 |
| 34 | Traits | Defenders and strikers with *cabeceio* | +0.01 | +0.01 | −0.01 |
| 35 | Traits | Defenders with *marcação* | 0.00 | 0.00 | 0.00 |

Baseline: 1.69 points per game at home for a 70-rated team against a 70-rated team, +0.48 goal difference. For scale, the gap between a title team and a relegated one is about 1 point per game.

**In short**, from most to least important:
1. **Squad quality** (força) and **energy**. Five points of força are worth about 0.4 points per game, and so is going from 95% to 75% energy. Energy is the cheapest lever a manager controls (rotation, training focus, travel, the training centre).
2. **Home advantage**: about 0.65 points per game, a flat ×1.07 on every duel.
3. **Midfield**, the most valuable sector: +10 there is worth more than +10 in attack or defence (+0.19 each) or in goal (+0.11).
4. **Shape**: formations that thin out the midfield (3-4-3, 4-3-3) lose a lot; 4-5-1 and 4-2-3-1 gain a little. Players out of position cost 10–30% each.
5. **Morale**: about ±0.2 points per game between the extremes.
6. **Reading the AI**: going all-out attack or pressing for 90 minutes now costs 0.10–0.14 points per game, because the AI coach answers with counter-attacks and long balls. The three styles are even (within ±0.04), and traits are mostly under 0.1.

## 10. Ideas for what to add or tweak

**Balance problems the measurements show**
- **Formations without central midfielders are heavily punished** (3-4-3 −0.51, 4-3-3 −0.29). Midfield decides the middle-third duels and counts in the other two, and a sector with less total weight than a 4-4-2 also gets the "short-handed" penalty meant for missing players. Ideas: apply that penalty only to missing players, or let wingers and forwards count more for midfield while their side has the ball.
- **Midfield outweighs everything else.** A world-class striker or keeper matters much less than a good midfielder. Ideas: raise the exponents in the goal formula (shooter ÷ keeper is ^0.95, attack ÷ defence ^0.5), or make the final-third duel lean more on attack.
- **Pressing only hurts** (−0.10 against the AI coach for 90 minutes): it costs 25% more energy and more fouls for a 3% midfield boost, and the AI answers it with long balls. Ideas: pressing could lower the opponent's pass accuracy in their own half and win the ball higher up, creating short counter-attacks, so that pressing in bursts is worth it.
- **Posture alone is weak**: its value now comes from the matchups (ofensiva opens space for counters, defensiva crowds the box). Ideas: bigger sector shifts, or posture changing the shot rate and the number of players committed forward.
- **The AI coach's thresholds** (edge ±3, the minutes in section 6, one change every 10 minutes) are guesses that play sensibly. `tools/leaguebalance.ts` checks that leagues stay realistic after changing them.
- **Most traits are cosmetic**: *finalização*, *cabeceio*, *reflexos* and *drible* are all worth 0.01–0.06, and *marcação* only lowers yellow cards. Ideas: *marcação* lowers opponents' dribble and pass success near the player; *finalização* raises the shooter factor more (now ×1.10); *reflexos* adds more than 4%.
- **In-match fatigue barely matters** (a veteran squad −0.05). Players lose only about 12 energy per match, so substitutions are rarely forced by tiredness. Ideas: steeper drain late in matches and for pressing, with faster recovery between rounds so it doesn't snowball.

**Realism**
- **Too many turnovers**: about 70% pass accuracy, 310 passes and 33 tackles per team, against roughly 80–85%, 450 and 17 in real football. Raising pass success and lowering dribble frequency would fix the stats, but shot and goal rates would need recalibrating (`tools/calib.ts`, then `tools/sensitivity.ts` to check the styles stay even).
- **Shots per team are a bit high** (about 17, against 12–14 real) and shots on target too (about 7, against 4–5).

**New inputs worth adding**
- **Home advantage** is a constant. It could grow with attendance (a full stadium), travel distance, altitude (La Paz, Quito) and derbies, which would also make ticket prices matter beyond money.
- **Player attributes**: one força number per player plus traits. Pace, technique, defending, aerial ability and stamina would make roles, custom positions and traits matter.
- **Space and width**: custom positions only change roles and pass targets. Leaving a flank empty has no cost beyond the sector weights.
- **Weather and pitch, referees** (card strictness), **team chemistry** (new signings, familiarity with a shape), **captaincy** (a *liderança* player as captain).

To try an idea: change the numbers in `STYLE_TUNE`, `core.ts` or `ratings.ts`, run `npx tsx tools/calib.ts` to keep goals near 2.7 per match and home wins near 46%, then run `npx tsx tools/sensitivity.ts` to see what moved.

