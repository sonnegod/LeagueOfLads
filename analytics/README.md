# Analytics foundation

`Analytics.db` is a private, derived SQLite database. Its worker reads committed
league/public data, validates it, and publishes a generation of facts and
summaries. It does not calculate odds, create markets, or touch Betting wallets.

## Run locally

From the repository root with `ENVIRONMENT=DEV` in `.env`:

```bash
npm run analytics:build
npm run analytics:status
```

On PowerShell, use `npm.cmd` if execution policy prevents `npm.ps1`.
The build automatically creates/migrates `db/Analytics.db`. To initialize the
schema without reading source data, use `npm run analytics:init`.

Source databases must exist; they are opened read-only with `fileMustExist`.
Missing `public.db` is reported as unavailable, allowing league facts to build.
Missing/incompatible league schema fails the build and preserves the previous
publication. Restore/start the existing app's league database setup first.

Explicit paths are supported:

```bash
node scripts/analytics/build.js --league-db db/LadsData.db --public-db db/public.db --analytics-db db/Analytics.db
```

The target cannot be a source database or another existing application database.
Status reads do not create a missing database. Each run exits nonzero on failure
or an overlapping build. A lease protects job startup, and SQLite's single writer
and one publication transaction protect the build itself. An abandoned lease
expires after 30 minutes. A subsequent run marks abandoned run records interrupted.

## Signup-era scope

`SeasonStore` adopts old leagues into `LeagueSeasons`; those rows alone are not
proof of signup-era membership. The first included season is detected from a
saved signup title or a genuine submitted roster. Successful runs remember that
cutoff. Subsequent seasons, including draft/unlinked teams, retain their stable
`TeamSubmissionId` identities. Earlier warehouse leagues are excluded.

For an explicit known cutoff:

```bash
node scripts/analytics/build.js --first-season 3
```

The same override is available as `ANALYTICS_FIRST_SEASON_ID`. Use the actual
first signup season ID for the deployment, not a Dota league ID. If no signup
season exists yet, a successful empty build reports `no_signup_seasons`.

## Other seasons and historical previews

Normal builds already include completed signup-era seasons, regardless of which
league is active. To limit a build to one signup season:

```bash
node scripts/analytics/build.js --season-id 3
```

Use the internal `LeagueSeasons.SeasonId` here. This still enforces the signup-era
cutoff. It changes only the derived dataset, never the active league or sources.

For real data from an older league that predates signups, use an isolated preview:

```bash
node scripts/analytics/build.js --preview-league 19817
node scripts/analytics/build.js --preview-league 19817 --status
```

Here `19817` is a Dota league ID (Season 21 in the local warehouse). The default
output is `db/Analytics-preview-19817.db`, separate from `Analytics.db`. The CLI
refuses to write historical previews into the configured canonical Analytics
file. You may specify another separate `--analytics-db` path for offline inspection.

In Site Management → Analytics, select **Preview: League Of Lads
Season 21** in the Dataset dropdown after building it. The status reader selects
the corresponding preview file. SQLiteStudio can inspect its facts and summaries.

Preview teams use negative internal fact keys derived from the original team IDs;
the preview season key is the negative league ID. These are not signup submission
IDs. Team/group alignment comes from existing roster entries or legacy groups.
Player membership is always `unknown`, even if the source has a latest lineup or
signup-like records. Records are retained by player/team/stage for inspection,
but are never eligible for roster-only bets. The Betting reader refuses preview
generations. Missing dates/stages/stats remain flagged. No source signup/roster
rows are invented and no active league/status is changed.

## Published data and quality

- Seasons, teams, players, effective roster membership, official match/team/player
  facts, team records, and metric totals/means/min/max/population variances.
- Regular season, tiebreaker, playoff, and unknown stage are separate scopes.
- Rostered, stand-in, and unknown membership are separate aggregates.
- Last ten eligible games provide recent averages with explicit valid samples.
- Frozen signup MMR, pending submission MMR, and manual team averages are private
  inputs. Finalized rosters do not fall back to mutable form MMR when their frozen
  snapshot is missing. No screenshot payload is copied into Analytics.
- Private public-match K/D/A summaries cover the last 90 days and only records
  observed by the snapshot's as-of time. Elo is absent.

Matches require a valid winner/duration, two uniquely aligned league teams, ten
distinct player/stat records, and five participants on each side. Identical
duplicates are collapsed; conflicting duplicates reject the match. Active/ended
team alignment comes from `LeagueRosterEntries` where that table exists.
Unmapped teams, incomplete games, unresolved rehosts, and conflicting series
links are flagged and excluded. Unknown stage/time/roster membership is explicit.
Estimated roster periods are not silently treated as authoritative membership.

`PlayerTeamSeasonStats.MarketEligible` is a participation flag for rostered
regular-season games: at least five appearances AND strictly more than half the
team's official games. It is not a final permission to open/settle any bet.
Metric completeness, source quality, fixture readiness, and Betting's market
rules must also pass. Missing metric values stay null and reduce `Samples`;
Betting must hold a metric with missing required games rather than silently
settle it using a reduced denominator. GPM/XPM season totals are disabled in the
metric catalog; net worth is retained for analysis without being an initial market.

## Expanded EDW features (schema version 7)

Analytics now reads the normalized EDW tables without making OpenDota requests
or unpacking/copying compressed source responses. The build remains read-only
against `LadsData.db`; all new facts are derived in `Analytics.db`.

### Match time and availability

`MatchTeam.StartTimeUtc` is the preferred kickoff time. The EDW stores Unix
seconds; Analytics converts them to an ISO UTC instant. Older exact times in
`MatchSourceDetails` or `MatchLeague.DatePlayed` remain fallbacks. A date-only
value is never promoted to an exact midnight kickoff.

`SourceObservedAtUtc` is separate from kickoff. The latest valid core observation,
EDW successful import, or archived-response collection time is retained
conservatively. A historical import or repair does not pretend its current values
were available before that observation. Games observed after the build's as-of
time, or not completed by that time, are excluded. Rebuilding does not advance
the ingestion source-freshness watermarks.

Imported completed leagues without signup settings or team submissions stay
outside the normal dataset even if a later champion backfill assigned them an
internal season ID above the signup cutoff. Historical previews remain available.

### New tables

| Table | Contents |
|---|---|
| `MatchContextFacts` | Patch, scores, first-blood seconds, enrichment status, section coverage, observation time and feature version. |
| `PlayerPerformanceFacts` | Lane role, roaming, denies, level, wards placed/destroyed, stacks, stuns, neutral/ancient/objective kills, dewards per 10 minutes, contribution shares and kill participation. |
| `PlayerEconomyCheckpoints` | Exact gold earned, XP and last-hit observations at 10/20/30/40/50/60 minutes, only for matches that reached the checkpoint. |
| `TeamEconomyCheckpoints` | Gold/XP advantages and complete five-player economy totals at the same checkpoints. |
| `TeamPerformanceFacts` | Observed lead/deficit extremes, timeline coverage, 10k comeback/lost-lead outcomes, objective control and recorded fight outcomes. |
| `TeamfightFacts` | Per-side deaths/kills, damage, signed gold/XP changes, buybacks, inferred outcome and objectives recorded shortly afterward. |
| `PlayerItemTimings` | First recorded purchase per player/game/item, including pregame purchases. These are purchases, not final inventory. |
| `PlayerPerformanceStats` | Per-season/team/player/stage/membership summaries, including economy checkpoints, with separate valid samples per metric. |
| `TeamPerformanceStats` | Equivalent team summaries and economy checkpoints. |
| `PlayerHeroPatchStats` | Player/hero/patch/lane-role/stage/membership cohorts, games/wins and metric summaries with explicit samples. |
| `HeroItemStats` | First-purchase timing summaries by season, hero, patch, lane role, stage and item. Includes all appearances. |

Missing values stay null, while recorded zeroes count. Team damage/healing/net-worth
shares require the statistic for all five players and a nonzero team total.
Shares and kill participation are percentages from 0 to 100. `GoldEarned` comes
from `gold_t`, which is cumulative gold earned, not net worth. A missing checkpoint
is not filled from an earlier/later sample. Dewards per 10 minutes is
`(observer kills + sentry kills) * 600 / match duration in seconds`.

`Comeback10k` is a win/loss observation only for games with a recorded deficit of
at least 10,000 gold. `Lost10kLead` is a loss/win observation only for games with
a recorded lead of that size. Their `Samples` are those opportunities, their
`Total` is the number of successes, and `Average` is a fraction from 0 to 1.
Extremes are explicitly recorded-sample extremes; `GoldTimelineComplete` checks
every expected minute. No eligible lead/deficit means a null conversion metric.
`FirstTower`/`FirstRoshan` use the same 0/1 convention and stay null when no such
objective occurred or attribution is unknown. Known objective sections with no
events have zero counts; unavailable sections have null counts.

Fight outcomes are inferred from fewer deaths, then higher team gold delta for
equal deaths. Missing decisive data yields `unknown`. All five participants per
side are required for each fight total. Real pre-horn fights retain negative
timestamps. Objectives afterward are events within 90 seconds, before the next
recorded fight and within the match, not proof that the fight caused the objective.

Rate/share/checkpoint totals are disabled where a sum would be misleading.
Summaries use arithmetic per-game means and population variance. Lane role is the
recorded lane classification, not a claim about carry/support position. Unknown
patch and lane role use `unknown` and `0`, respectively. Patch and lane cohorts
stay separate; small cohorts are not presented as reliable rankings.

### Betting and highlights

`readSeasonPerformanceInputs()` in `analytics/bettingInputs.js` provides a private,
bounded, versioned contract for the new player/team summaries and hero contexts.
It refuses historical-preview generations. Existing market definitions, prices,
settlement metrics, eligibility and accepted tickets are unchanged. New features
must pass temporal model validation before a Betting model consumes them; unused
feature bundles are not added to existing Betting input snapshots.

Automatic league highlights also recognize dewarding, stacking, stuns, recorded
10k comebacks, clean five-kill fights, strong fights followed by objectives,
farming checkpoints, team contributions, early item purchases and Roshan control. They share existing daily
quotas, moderation, correction/withdrawal and stand-in labeling. No public-match,
signup MMR or other private pricing inputs enter the public templates.

Initial editorial thresholds are 80 last hits at 10 minutes / 180 at 20;
45% team hero damage with 30,000 damage, 60% team healing with 10,000 healing,
or 90% kill participation with at least 20 team kills. Contribution denominators
require all five players' relevant statistics. These are standout single-game
moments, not role-adjusted rankings. Early purchases use first recorded purchase
times after the horn: Blink by 12 minutes, BKB by 18, Battle Fury by 14,
Radiance by 16, or Aghanim's Scepter by 15. They do not claim inventory completion
or patch records. Roshan control requires at least three recorded kills with
available objective data. Gold earned at checkpoints is cumulative earned gold,
not net worth. Supporting details are an explicit public allowlist.

Run `npm run analytics:build` to migrate and rebuild the normal signup-era dataset.
Or use Site Management → Betting → Refresh Analytics and Betting to run the complete
existing refresh pipeline. A signup-only season has no match features yet.
For historical viewing, create an isolated preview, for example:

```bash
node scripts/analytics/build.js --preview-league 19264
```

This writes `Analytics-preview-19264.db`, not the live Analytics dataset. The admin
Analytics widget reports enriched matches, EDW UTC start times and known patches.
All new facts follow the existing atomic publication and two-generation retention.

## Automatic highlights and recaps

Every successful Analytics build generates and validates league-only stories,
then publishes them in the same transaction as the fact generation. No separate
command or manual migration is required. Existing nightly/deploy builds run this
step automatically; a failed build preserves both the prior facts and stories.

The first templates cover standout farming, experience, hero/tower damage,
healing, kills, assists, deathless wins, recorded season highs, winning streaks
and streak endings, hero popularity/variety, and official champion game records.
Season highs compare validated games in the same season/stage through a stated
match ID, with at least five games and complete metric coverage. Stand-in
performances are labeled; unknown membership is explicitly unclassified.
Stories never imply pre-signup all-time records. Comebacks require observed
gold timeline evidence rather than an inference from the final result.

Daily recaps cover the previous completed calendar day in `America/New_York`.
Weekly recaps cover Monday–Sunday and publish after that week closes. Both use
verified match start times, not source upload times or legacy date-only fields.
They summarize games, team win leaders, recorded total kills, and GPM/XPM average
leaders where at least five valid appearances and complete metric coverage exist.
Recaps cover all stages/appearances, including labeled stand-ins. Recorded 10k
comebacks and standout dewarding also appear when available. Undated games
are excluded and that limitation is stated. Empty periods produce no recap.
The next successful build publishes the most recently completed day/week;
older backfilled recaps remain inspectable candidates. It does not fill a feed
with historical daily recaps after a long outage.

Up to five daily stories, including daily recaps, publish across all builds of a
local calendar day. Weekly recaps are additional. A player can occupy at most
one daily slot, a team at most two, and a category at most two. Selection
reserves room for two distinct player moments when eligible candidates
are available, preferring different categories, within the same five-story budget.
League stories retain their score ordering in the other slots; unused slots can
be filled by either kind. Existing publications keep their slots across rebuilds. Single-game
candidates have a 48-hour window from their first Analytics observation; older
matches newly discovered by Analytics retain their actual played date (or an
unverified-date label). No story is described as played overnight merely because
it was ingested overnight. Current hero/champion summaries keep stable identities
and are revised when their supporting facts change.

Stories use stable fingerprints and retain publication/revision history beyond
the two retained fact generations. Identical reruns create no duplicate stories
or revisions. Source corrections revise stories; invalid supporting records
withdraw them. Withdrawn/hidden stories still consume their original daily slot.
Filtered `--season-id` builds do not withdraw other seasons' publications.

In **Admin → League → Highlights**, available during an active league and hidden
during signup/setup, **Automatic highlights** shows published, candidate, or withdrawn stories, with
20-row pagination. Admins can hide/unhide stories, edit their title/body, restore
generated text, or pause/resume new publication. Overrides survive rebuilds.
If source facts change underneath edited text, the override remains stored but
is held out of the public feed until an admin reviews/saves it or restores
generated text. Pausing stops new publications; correction/withdrawal processing
continues. Admin changes are audited with the existing acting-admin context.

The homepage shows a compact public feed when published signup-era content
exists, for logged-in and anonymous users. It opens on the **Content** parent
tab, with highlights/recaps, signup announcements, and offseason champions.
**League Info** contains the active league or last champion's season; those
league views load when that tab is opened. Content is a catch-up feed for league
players: **Season watch** shows the current stage and up to three standout team
runs, a featured headline leads with published stage/series stories and recaps,
and **Player moments** is a notification table with when, player/team, achievement,
and a match link. Hero icons identify single-game player moments. The desktop
overview puts the featured story and compact season watch above a visible
**On the scoreboard** series list and the player table. Expand a series for its
individual games or open **All games** for the paginated result history.
Visible row counts respond to the remaining viewport height;
extra items use pages, and story details, champion player cards, and full game
results open in accessible dialogs. Narrow screens stack the panels. Team form
includes season and stage game W–L records and the latest linked series score.
Unverified historical series scores are labeled as recorded, not completed;
missing imported games or conflicting teams suppress the score entirely.
The **Overnight** filter covers the
last 24 hours; **Last week** covers the last 7 days. These are rolling windows,
separate from the completed calendar periods used to generate daily/weekly
recaps. All displayed match times use New York time. Season watch is current
season context rather than a time-filtered leaderboard; ended seasons show
strong finishes rather than describing them as ongoing runs. Form compares up
to five recorded games within one stage, requires at least three games,
and highlights three consecutive recent wins or at least four wins from five.
It makes no qualification/seeding claims.

Builds now publish group/playoff hot runs, the opening of tiebreaker/playoff
stages, and verified reverse sweeps. Reverse sweeps require a known BO3/BO5
format from an explicitly linked bracket slot (or an explicit source format),
the complete linked game set, verified non-overlapping start times, and a legal
final score. BO3 requires loss/win/win; BO5 requires loss/loss/win/win/win.
Incomplete series, missing dates/formats, rejected games, and extra games after
the clincher do not produce comeback claims. Corrections withdraw invalid
stories through the existing revision pipeline. Season watch respects hidden
or review-held hot-run stories; publication pause still allows fact snapshots
to update, just as it does for game results.

`GET /api/analytics/dashboard?period=overnight&leagueId=100&limit=10&before=123`
returns a bounded, explicit results projection, up to ten recent series (or
standalone games), and whole-window counts from one
published generation. The period can be `overnight` or `week`; optional league,
cursor, and limit parameters follow the highlight API's bounds. Dates must be
verified for inclusion. Reads use only derived Analytics facts, are cached for
15 seconds, and never read the warehouse or private features.

Series scores include all their recorded games, even if only the latest game
falls in the requested window. A regular-season BO2 is final only with both
source-linked games imported, verified times and consistent teams. Playoff
finals use the existing complete BO3/BO5 checks. Other scores say **Recorded
score**. No inferred series format is written back to the source database.

The highlight API is
`GET /api/analytics/highlights?leagueId=100&limit=6&before=123` (filters/cursor
optional, limit at most 20; `period=overnight|week` filters player appearances by
played time, and league events by occurred time when verified, otherwise
publication time). Reads are cached for 15 seconds, query published
content only, and return explicit public fields. They never scan the warehouse.
The UI loads ten game results and twenty highlight rows at a time, up to fifty
of each per view, without background polling. Admin moderation retains its
story cards and controls.

For a historical preview, rebuild and select it in Site Management → Analytics:

```bash
node scripts/analytics/build.js --preview-league 19817
```

Preview story generation/publication stays inside `Analytics-preview-19817.db`
and is inspectable in Site Management/SQLiteStudio. For homepage layout testing,
sign in as a site manager and open `/?previewLeague=19817`, or choose this dataset in
Site Management → Analytics and click **Preview on homepage**. The banner's **Exit preview** button
restores the normal feed. This uses a protected, read-only endpoint with the same
published/hidden/review filters and public story fields as the normal feed.
The historical dashboard has a **Historical season** filter, populated from the
preview generation through a protected results endpoint. It includes undated
results with an explicit date-unavailable label, rather than claiming they
occurred in a recent window. The public endpoint rejects preview generations; preview content cannot enter
the canonical homepage feed or be read by a non-admin through the preview route.
Legacy matches without verified timestamps generate performance stories but
cannot enter dated daily/weekly recaps until their EDW start times are available.

### Added content tables

| Table | Purpose |
| --- | --- |
| `HeroFacts` | Hero names used by a fact generation's league templates. |
| `ChampionFacts` | Official signup-season champion team, when set and aligned. |
| `GroupFacts` | Names for the season's group alignments. |
| `SeriesFacts` | Linked league series, authoritative playoff format/round context, and source match count used to validate complete series stories and dashboard scores. |
| `HighlightMatchHistory` | First Analytics observation of each season/match; prevents old candidates becoming new on every rerun. |
| `HighlightEvents` | Generated stories, supporting evidence/comparison scope, fingerprints, revisions, publication state, and persistent admin overrides. |
| `HighlightRevisions` | Durable generated, published, corrected, withdrawn, and moderated versions, including acting admin IDs. |
| `HighlightSettings` | Persistent publication pause state for this database. |

`HeroFacts`, `ChampionFacts`, `GroupFacts`, and `SeriesFacts` are scoped to retained generations. Content
history/settings intentionally survive generation cleanup and are included in
the existing whole-database Analytics backups. `HighlightEvents` includes
unpublished candidates; filter `Status = 'published' AND Hidden = 0 AND
OverrideNeedsReview = 0` when inspecting the public collection.

## Source freshness and time provenance

Ingestion jobs add `SourceLoadRuns` in their own source database. A partial or
failed job never advances the last successful watermark. A 48-hour limit is
calculated from that watermark, not from the Analytics build time or last match
date. Existing source data is `untracked` until an instrumented job runs.

League jobs record API start time in `MatchSourceDetails` and correct
`MatchLeague.DatePlayed` for the matches they actually fetch. Series dates now use
the actual New York match day. Analytics prefers the expanded EDW UTC instant
when available. Date-only records without an exact EDW/API time are not converted
into invented exact times; they carry an unknown timestamp. Historical
replay cannot be reconstructed by changing an as-of date against today's mutable
source database; it needs retained source/feature snapshots.

History batches and individual parsed-match writes are transactional. Failed
inserts do not leave half-parsed matches that get skipped forever. Detail parsing
is restricted to the active league; partial loads retain their previous successful
watermark while the nightly wrapper still builds independently valid facts.

Public ingestion now includes upcoming signup players, pages the 90-day history,
and records each observed match/player in `PublicMatchAvailability`. Legacy rows
without availability do not enter private features until observed by that job.
Partial/public-source failure is a quality signal; the Betting engine must choose
a validated league-only fallback or hold prices. The pagination parameters are
documented by the [OpenDota API](https://docs.opendota.com/).

## Consumer and API boundaries

`readSeasonBettingInputs(db, seasonId)` in `bettingInputs.js` is a server-only
interface. It pins one published generation in a read transaction and returns
season-scoped facts, metric completeness/participation flags, source freshness,
and private inputs. The Betting engine owns forecasts, margins, pool
movement, market creation, accepted prices, and settlement in `Betting.db`.
It must retain the consumed input snapshot and generation reference: Analytics
keeps only two complete data generations and up to 100 run metadata records.

`GET /api/site-management/league-analytics/status` is restricted to site managers.
It returns an explicit operational projection: last run,
counts, source watermarks, and aggregated issue codes. It excludes feature values,
raw rows, source paths, screenshots, and exception text. Site Management → Analytics
shows this status with a manual refresh. Highlight moderation remains in the
league-admin Highlights tab through `/api/admin/analytics/highlights`; this limited
router does not expose Analytics status, catalog or homepage preview endpoints. Highlight
routes return only curated league content; the public route never reads private
features. No homepage background polling is added for highlights.

## Deployment and scheduled jobs

Deployment runs `node scripts/analytics/build.js` before restarting PM2. The
workflow now fails on a build error. The first build can report untracked sources;
the next successful league/public jobs establish real freshness watermarks.
Ingestion tables/indexes are additive and created by those jobs automatically.

`nightlyRun.sh` runs Analytics after league ingestion. With no active league, it
records a verified no-active-league check and still builds signup/history facts.
The existing public wrapper remains its own job; whichever successful public
snapshot is available is recorded explicitly. The replacement Betting worker now runs after Analytics, including
between active seasons. Admin edits and changed Discord fixtures queue separate
refreshes. See [betting/README.md](../betting/README.md).
`backupDatabases.sh all` now includes SQLite-safe Analytics backups.

On the server, to build/inspect immediately after deployment:

```bash
cd /root/LeagueOfLads
node scripts/analytics/build.js
node scripts/analytics/build.js --status
```

No manual Analytics SQL migration is required. This worker does not contact APIs.
It does not fabricate freshness for existing source files.

## Verification and remaining phases

```bash
npm run test:analytics
```

Tests cover scope, roster/stand-ins, participation, metric completeness, source
availability/freshness, private projection, publication rollback, bounded
generations, overlapping jobs, public paging/validation, highlight quotas,
daily/weekly time boundaries, corrections/withdrawals, moderation, and preview
isolation. See `AnalyticsOverhaul.md` for the full plan. Event-triggered refresh, canonical scheduling, and the initial Betting
models/markets/wallets are implemented separately in Betting. Eligible validated
markets publish automatically; unsupported formats and insufficient signup-era
history hold prices. Further private-model calibration remains a later phase.

Version 8 adds `PrivatePendingRosterSlots` for admin-declared Player TBD slots.
It retains the private estimated MMR alongside its team and slot, with no fake
player identity. `PrivateTeamFeatures` includes that estimate in the five-slot
average and labels the roster `provisional_roster`. Confirmed player membership
remains separate. Public projections show only the pending count; estimates do
not enter browser responses. Confirming a slot uses its actual player/MMR and
effective membership, without rewriting the original signup submission.
