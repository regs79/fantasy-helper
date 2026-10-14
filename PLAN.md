# Fantasy Helper – Plan

League: Yahoo fantasy basketball, 11-category head-to-head, auction draft,
no waivers, unlimited moves.

## League settings

- 12 teams, $200 auction budget each ($2,400 total in the room)
- Categories (11): FGM, FG%, FT%, 3PM, PTS, OREB, DREB, AST, STL, BLK, A/T
- Roster slots, IL slots, and weekly lineup rules: still to confirm (read
  from Yahoo league settings in Phase 0)

## What this category set does to player value

This is not the standard 9-cat list, so generic rankings and dollar values
from the usual sites are wrong for this league. Specifics:

- **Three ratio categories (FG%, FT%, A/T).** Each must be volume-weighted.
  A player's FG% impact is roughly `FGM - league_avg_FG% * FGA`, FT% likewise,
  and A/T impact is roughly `AST - league_avg_ratio * TOV`. A low-usage player
  with a pretty ratio barely moves the needle; a high-volume player moves it
  a lot in either direction.
- **No standalone TO category, but A/T punishes turnovers.** Turnover-prone
  bigs and ball-dominant scorers with low assist counts get hit here, while
  pass-first guards get a boost that 9-cat rankings do not show.
- **FGM + FG% + PTS triple-counts efficient volume scoring.** High-usage,
  high-FG% players (mostly interior scorers) gain value; inefficient volume
  scorers lose it.
- **REB split into OREB and DREB double-weights rebounding.** OREB is scarce
  and concentrated in a small set of bigs, so it behaves like a premium
  category. DREB is spread more widely.
- **Rough positional lean.** Bigs own FGM, FG%, OREB, DREB, BLK (5). Guards
  own 3PM, AST, STL, A/T, FT% (5). PTS is neutral. Builds that lean one way
  and punt one or two categories on the other side are natural here:
  big-heavy punting FT% and A/T, or guard-heavy punting OREB and BLK.
- **Streaming has a cost in ratio categories.** Adding games adds counting
  stats, but a streamer with poor FG%, FT%, or A/T can flip a close ratio
  category. The streaming recommender must score pickups on net category
  impact for this week's matchup, not raw production.

## Auction math

- $2,400 total. With N roster slots per team, reserve $1 x 12 x N as the
  floor and distribute the remaining dollars in proportion to value above
  replacement. With 13 slots that is $156 reserved and $2,244 to allocate.
- Track inflation live: remaining dollars in the room divided by remaining
  projected value of the draftable pool. Recompute after every pick.
- Nominations: lead with players you do not want who will cost others money.

## What the format rewards

- **Auction draft**: value is dollars, not ADP. Need a projection -> value
  -> price engine with live inflation tracking as money leaves the room.
- **11-cat H2H**: weekly matchups decided category by category. Punting one
  or two categories is viable; the app must evaluate rosters against the
  league's actual categories (read them from Yahoo, never hardcode).
- **No waivers + unlimited moves**: streaming is free and instant. The
  dominant in-season edge is maximizing games played per week and chasing
  the categories that are close in *this* matchup. Daily greedy optimization
  beats long-term roster hoarding for the last 2-3 roster spots.

## Phases (season starts Oct 20, 2026, so in-season tooling first)

### Phase 0 – Plumbing (first)
- Register a Yahoo developer app, OAuth2 flow, token refresh, local token
  cache. Request read/write access up front and note the justification;
  approval is not automatic, so design everything to work read-only.
- Pull and persist: league settings (categories, roster slots, budget),
  teams, rosters, current week matchup, free-agent pool with injury status,
  season/last-N-games stats, draft results.
- Pull the NBA schedule and derive games-per-team-per-fantasy-week for the
  whole season (handle Yahoo's week boundaries, All-Star break, play-in).
- Store in SQLite. Everything downstream reads from the local store.

### Phase 1 – Weekly matchup planner
- Project both teams for the current week: per-game projections x games
  remaining, then category win probabilities (treat each category as a
  distribution, not a point estimate; FG%/FT% need volume weighting).
- Show which categories are locked, lost, or coin flips. Suggest which to
  chase or concede this week.

### Phase 2 – Streaming recommender (the daily workhorse)
- Rank free agents by: games remaining this week x marginal value in the
  categories that are still in play, minus the value of the player dropped.
- Account for tomorrow too: a pickup with 3 games this week and 4 next week
  beats one with 3 and 2, since there are no waivers to recover a drop.
- Flag roster holes: empty active slots on game days, injured players in
  the lineup, bench players with games while active players sit.
- Phase 2b (needs write access): one-click add/drop and lineup set via the
  API. Until then, print the exact move to make in the Yahoo app.

### Phase 3 – Auction draft tool (build during the season for next October)
- Projection ingestion: bring-your-own CSV (Hashtag Basketball, Basketball
  Monster, etc.) plus a fallback built from last season's Yahoo stats.
- Value engine: per-category z-scores over the draftable pool, with punt
  toggles that recompute values excluding punted categories.
- Dollar conversion: budget x teams, replacement-level baseline, then live
  inflation adjustment as Yahoo draft results stream in (poll the draft
  results endpoint).
- Draft board: remaining budgets by team, max bid per team, your roster's
  category profile so far, nomination suggestions (nominate players you
  don't want to drain others' budgets).

### Phase 4 – Nice to have
- Trade evaluator using the same value engine.
- Season-long record vs. category win rates to spot systemic weaknesses.
- Notifications (injury news on your players, lineup not set).

## Tech choices (proposed)

- Python 3.12: pandas/numpy for the value math, SQLite via sqlite3 or
  duckdb, `yfpy` or `yahoo_fantasy_api` for Yahoo (both wrap the same
  REST API; evaluate which handles OAuth refresh and NBA endpoints better,
  or call the REST API directly with `requests-oauthlib`).
- CLI first (`typer`), since most daily use is "what should I stream
  today". Add a FastAPI + HTMX web page later for the draft board, which
  benefits from a live-updating view.
- Projections and schedule as swappable adapters so sources can change.

## Open questions

1. Roster slots and IL slots?
2. Has this year's draft already happened?
3. Yahoo Dev app registered? Any preference for Python vs. TypeScript?
4. Preferred projection source, or build from stats only?
