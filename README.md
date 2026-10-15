# fantasy-helper

Auction draft helper for a 12-team, 11-category Yahoo fantasy basketball
league. See [PLAN.md](PLAN.md) for the league settings, the reasoning behind
the value model, and the roadmap. This README is the operator's manual.

## Setup

```bash
npm install
cp .env.example .env   # fill in Yahoo credentials when you have them
```

Node 22+. `./fh` is the CLI (`node --import tsx src/cli.ts`). Everything
mutable lives in `data/` (gitignored): projections, draft state, Yahoo token
and cache. `config/league.json` holds teams, budget, categories, and roster
slots; the roster layout is config, so a 13-slot league is a one-line change.

## Draft day, step by step

1. **Load projections.** Either a CSV from any projection site:

   ```bash
   ./fh import path/to/projections.csv
   ```

   Columns are auto-detected (Player, Pos, GP, MPG, PTS, REB or OREB/DREB,
   AST, STL, BLK, 3PM, FG%+FGA or FGM/FGA, FT%+FTA, TO). Override any
   column with `--map field=Header`, e.g. `--map tpm=3PTM --map tov=TOV`.
   Season totals are detected and divided by GP. If the file only has total
   REB, the OREB/DREB split comes from last season's Yahoo share when
   `data/yahoo/players.json` exists, else a position default.

   Or last season's Yahoo stats as the fallback:

   ```bash
   ./fh yahoo players --as-projections
   ```

   `samples/projections-sample.csv` is a small illustrative file for trying
   the tool; its numbers are placeholders, not real projections.

2. **Check the values.**

   ```bash
   ./fh values                      # top 60 with $ price and per-category z
   ./fh values --punt ft_pct,ato    # same, punting two categories
   ```

3. **Start the draft.**

   ```bash
   ./fh draft new --teams "Craig,Alice,Bob,..." --me Craig
   ./fh draft new --yahoo           # team names and which is yours, from Yahoo
   ```

4. **Open the board.**

   ```bash
   ./fh board            # http://127.0.0.1:3000
   ```

   - `/` focuses search, `↑`/`↓` move, `Enter` opens the pick dialog with the
     suggested price and your team preselected, `Enter` again records it.
   - Click a row to pick with the mouse. `Ctrl+Z` or **Undo last** reverts.
     Each recent pick has its own remove button.
   - Prices are recomputed after every pick from the money and slots left in
     the room. **Base** is the pre-draft price; the green/red delta is
     inflation. Max bid per team already reserves $1 per open slot.
   - Punt chips at the top exclude categories from value and price without
     recomputing the z-scores.
   - Click a team name to make it yours; double-click to rename.
   - **Sync Yahoo** pulls Yahoo draft results into the local state (needs the
     Yahoo setup below). Manual entry always works as the fallback.

   The same works from the terminal:

   ```bash
   ./fh draft pick "shai g" craig 60   # partial names are fine; ambiguous ones error
   ./fh draft pick "Some Rookie" bob 1 --new   # not in projections
   ./fh draft undo        # or: ./fh draft undo 7  (remove pick #7)
   ./fh draft board       # text board
   ./fh draft punt ft_pct,ato
   ```

## How values are computed

Per-game projections scaled by games played (`basis: "total"` in the config;
`"perGame"` ignores GP). Counting categories are z-scores over the draftable
pool (teams x slots, iterated so the pool stabilizes). Ratio categories are
volume-weighted: FG% impact is `FGM - poolFG% * FGA`, FT% likewise, A/T is
`AST - (poolAST/poolTOV) * TOV`, then z-scored. Value is the sum of z over
non-punted categories. Dollars: value above replacement (the first player
outside the pool) shares the money left after $1 per slot; floor $1.

## Yahoo

### Getting API access (2026)

Yahoo no longer self-serves Fantasy Sports API access. OAuth works for any
app, but every Fantasy endpoint answers `403 This application is not
authorized to perform this action` until the app is approved through
Yahoo's access program (enforced since 2026-07-22; the "Fantasy Sports"
permission is gone from the create-app form, and older apps that had it,
including read/write ones, were cut off too). Verified here on 2026-10-15
with two pre-existing apps. The client prints this explanation on that 403.

1. Apply at <https://sports.yahoo.com/developer/access/> with the Client
   ID of the app you want approved.
2. Sign the DocuSign "API Access and Use Agreement" Yahoo sends.
3. Submit the Client ID at
   <https://sports.yahoo.com/developer/application-confirmation/>.
4. Reports say apps created before the account was approved sometimes
   need to be recreated afterwards; if so, put the new id and secret in
   `.env` and run `./fh yahoo auth` again (tokens are bound to the app).

Reported turnaround is three to eight weeks, and only read access exists.
Until then every Yahoo command fails fast; the board's manual pick entry is
the plan for the draft.

### OAuth notes

`./fh yahoo auth` uses the authorization-code flow with `redirect_uri=oob`
(paste the code back). It sends no `scope`: Yahoo grants whatever the app
was registered with, and asking for `fspt-r` explicitly is rejected with
`invalid_scope` on an app registered as read/write. Set `YAHOO_SCOPE` to
override. Tokens are cached in `data/yahoo-token.json` and refreshed when
they expire.

### Commands

Put the client id and secret in `.env`, then:

```bash
./fh yahoo auth                # prints a URL, paste the code back
./fh yahoo leagues             # lists your NBA leagues, saves the only one as default
./fh yahoo use <league id>     # if you have several
./fh yahoo settings            # categories + roster; --write-config regenerates config/league.json
./fh yahoo teams
./fh yahoo players             # last-season stats + draft_analysis -> data/yahoo/players.json
./fh yahoo market              # attach Yahoo average auction cost to your projections
./fh yahoo draft               # raw draft results
./fh yahoo sync                # pull them into the local draft
./fh yahoo raw league/466.l.1234/settings   # any endpoint, for debugging
```

Every raw response from `settings`, `teams`, `draft`, and `raw` is saved
under `data/yahoo/raw/`. The parsers were written against Yahoo's documented
shapes and tested on fixtures; the live check is blocked on the approval
above. When access arrives, run the commands in the order listed and compare
each parsed result with its raw file. Things to look at first: the auction
budget field in settings (the config falls back to the existing budget when
Yahoo has none), whether GP/MIN/TO come back in league-context player stats
(if GP is missing, use `./fh yahoo players --stat-type average_season`),
and the `FGM/A` / `FTM/A` composite stats, which the importer splits into
made and attempted columns.

Whether a Yahoo **mock** draft is reachable through the API is still an open
question and cannot be tested until access is approved (mock leagues have
their own keys and may not appear under the user's leagues). To test against
a mock draft, run it in the Yahoo UI and enter picks by hand on the board;
that path is fully supported.

## Tests

```bash
npm test          # vitest: engine, importer, draft store/board, Yahoo parsing
npm run typecheck
```

## Deploying to flux

Same shape as shop-list: an amd64 image tagged with the git short SHA, pushed
to the plain-HTTP registry on flux, run by Compose there with the data dir
bind-mounted from `~/docker/data/fantasy-helper`.

```bash
npm run release   # build --platform linux/amd64, push, ssh flux, compose up
```

`release.sh` reads `REGISTRY`, `IMAGE`, `DEPLOY_SSH`, `DEPLOY_DIR` from
`.env`, refuses to run with uncommitted changes, copies `compose.yml` to
flux, sets `TAG=` in the remote `.env`, and verifies the running image carries
the new tag. Rollback is `TAG=<old sha> docker compose up -d` on flux. The
board is then at `http://flux:3010`.

The container joins the `apps-net` network, so Nginx Proxy Manager on flux
can forward a hostname to `fantasy-helper:3000` directly. The planned
address is `https://fantasy.rgnr.net` (LAN and VPN only); it is not set up
yet, so use the port until it is. The app uses only relative URLs, so no
configuration changes when the proxy goes in front.

Yahoo credentials on flux go in `/home/craig/docker/apps/fantasy-helper/.env`
(`YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, optional `YAHOO_LEAGUE_ID`). The
CLI runs inside the container:

```bash
ssh flux 'cd ~/docker/apps/fantasy-helper && docker compose exec -it fantasy-helper fh yahoo auth'
ssh flux 'cd ~/docker/apps/fantasy-helper && docker compose exec fantasy-helper fh yahoo players --as-projections'
```

Or do the Yahoo auth on the Mac and copy `data/yahoo-token.json` to
`~/docker/data/fantasy-helper/` on flux. Projections can also be uploaded
from the board's setup screen when none are loaded.
