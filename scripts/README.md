# Scripts

Utility and scheduled-job scripts live here to keep the project root focused on
app entrypoints and shared modules.

- `league/`: active league ingestion and standings jobs used by `nightlyRun.sh`
- `public/`: public match-data generation jobs used by `generatePublicMatchData.sh`
- `legacy/`: one-off historical league utilities
- `assets/`: asset download/build helpers

## Draft God

Draft God is private to Steam account ID **49219700**. Every `/api/draftgod`
request checks the authenticated Steam identity. League admin status, the legacy
`DraftAccess` table, session permission flags, and `ADMIN_ID` do not grant access.
Responses use `Cache-Control: private, no-store`.

The normal server restart creates the private draft, patch calendar, meta override,
patch-specific hero profile, and compact telemetry tables and indexes in LadsData.
It seeds the bundled patch calendar. Existing drafts are not overwritten. It also
adds `PublicPlayerSync` and public match date/player indexes when public.db is
initialized. No manual migration or database upload is required.

### Workflow

1. Open **DraftGod → Preparation**, select a season and the two teams. Signup
   teams work before their external team IDs are linked or their first game is played.
2. Confirm five different players on each side, replacing stand-ins through the
   player search. Positions are optional; configured positions must be unique.
   Historical lineups are suggestions, not finalized rosters.
3. Set first/second pick independently of Radiant/Dire, verify the action sequence,
   and choose the data cutoff. The default sequence is `league-cm-24-v1`; custom
   sequences are stored with each draft. Start the draft to freeze the config.
4. In **Live draft**, record actions, assign players or leave heroes as flex picks,
   undo/redo, and click a recorded pick/ban to edit it. The assignment solver uses
   each player once and respects known hero position constraints.
5. Drafts autosave after 750 ms idle. Refresh restores the last opened draft in
   this browser. **Save alternative** creates an independent scenario. A stale
   revision from another tab stops autosave and offers reopening or an alternative.
6. **Scouting** shows player pools, public practice, team tendencies and observed
   hero pairs. Private hero profiles let the owner maintain positions and traits
   for the league's patch. Unclassified traits stay unknown. These profiles are
   saved per patch. Reopened drafts use that patch's current private curation,
   identified as curated with today's knowledge rather than historical observations.
7. **Matchup overview** compares chemistry, pool pressure, player style, recent
   form, draft phases and responses, game-length results, and timeline evidence.
   Choose adaptive outcomes, current-patch-only outcomes, or the last 30 days.
   Meta overrides apply to a global patch boundary or one hero and can be reset.

The assessment is a symmetric heuristic on a 0–100 scale, not a win probability.
Player comfort uses games, smoothed results and usable recent public observations;
it does not compare raw farm/damage between support and core players. An empty
draft has unknown confidence. Team pick rates divide by completed team games.
Hero-pair results are historical associations, not causal counter estimates.
Composition coverage requires owner-provided hero metadata; no traits are invented.

### Data and performance

The API returns aggregated player/hero/team/matchup summaries, not raw duplicated
match histories. League summaries are cached for up to 60 seconds with database
revision invalidation and a three-entry bound. The browser only recalculates draft
analysis on those summaries. The page is loaded as a separate frontend chunk.
Legacy scouting continues to read league history directly; this does not expand
Analytics beyond its signup-era scope or change Betting's ownership of odds.

League inputs use dated history from up to five years at/before the selected league.
Seasons are not treated as patches. Only completed official games with valid teams and
winners count. Remakes marked `Rehost`, conflicting memberships, duplicate imports,
future games, and undated games are excluded. Since a date-only record does not
establish kickoff time, all such games on the cutoff day are excluded.

Public observations cover the 30 days before the cutoff with a 14-day half-life.
The existing `generatePublicMatchData.sh` job now discovers signup players before
their first game and records per-player collection successes/failures. It must
still be scheduled as before; opening Draft God does not fetch OpenDota. Missing
or stale public data falls back to league-only scoring. The UI distinguishes
last observed match date from successful collection. No Elo/MMR is used.

### Meta-aware evidence and timeline enrichment

The calendar comes from Valve's public datafeed, retaining major/minor boundaries.
Hero-change markers come from corresponding patch notes. Rework/replacement text
is conservatively flagged as a reset, not an inferred balance score. Unmentioned
heroes still receive a global discount because items, systems and opponents change.
Pair evidence checks both heroes.

Default policy (heuristic, not fitted probabilities):

- Outcome half-life: 60 days; major boundary transfer: 35%; minor: 90%.
- Additional hero transfer: changed 45%, reset 0%, unmentioned with notes 97%,
  unknown notes 65%. Owner overrides adjust the global or hero component.
- Familiarity half-life: 365 days; a reset retains 20% at that boundary. Older
  practice can support comfort without carrying an old win rate forward.
- Unknown patch outcome transfer: 10% in adaptive mode, excluded in strict modes.
- Matchup/pair scoring requires five retained outcome games. Retained games are
  the sum of policy weights, not an independent sample size estimate.

Descriptive tables show raw counts and patch splits. Current/recent modes filter
overview observations; familiarity can still carry older experience in the live
pool model. Team-ID history can contain other lineups; chemistry and lineup hero
pairs follow confirmed players across team IDs. Result changes are not asserted
to be caused by the patch. Profiles and overrides are current owner judgement,
not a reconstruction of what the owner knew at a historical date.

New league ingestion stores a compact whitelist from the OpenDota response it
already fetches. No extra request is needed for those games; rank, chat, MMR and
raw replay arrays are not retained. `nightlyRun.sh` refreshes the patch calendar
(up to 8 missing note summaries) and enriches up to 20 existing active-league
games. Source failures are logged without blocking standings or settlement.
Opening the page never performs external collection. Tables alone do not backfill
historical replays; run a bounded enrichment for a chosen season:

```bash
node scripts/league/syncDraftPatches.js db/LadsData.db 50
node scripts/league/enrichDraftGod.js db/LadsData.db --league=19264 --limit=20
# Optional targeted historical preview:
node scripts/league/enrichDraftGod.js db/LadsData.db --league=19264 --team=10027233 --before=2026-03-03 --limit=20
node --test tests/draftGod.test.js tests/draftIntelligence.test.js
```

Enrichment reads public endpoints at about one request per second, never requests
a paid replay parse, skips ready matches, and retries partial/error records after
7 days. `--force` deliberately refreshes ready matches. Each run is capped at 200
games. Some old replays remain unavailable. Lane snapshots, lead conversion,
comebacks, first objectives, fight follow-up and item timing medians each show
their own observation counts. Missing stays unknown; zero remains zero. Item
medians are among observed buyers. Lane gold baselines match hero, patch and
parsed lane, require five other-player observations, and do not infer numbered
farm positions.

Sources: [Valve calendar](https://www.dota2.com/datafeed/patchnoteslist?language=english),
[OpenDota API](https://docs.opendota.com/).

### Historical replay

```bash
node scripts/league/replayDraftGod.js db/LadsData.db db/public.db 19817 50
node --test tests/draftGod.test.js
```

The replay reads source databases without modifying them, uses a disposable SQLite
backup, and analyzes complete recorded drafts with their known five-player lineups.
Analytical match/public inputs must precede each game's cutoff. It reports scores,
coverage, outcomes and skipped records for inspection; it does not calibrate odds
or prove predictive accuracy. Patch-specific hero metadata is used where available.
Date-only games use
the start of their day to prevent same-day result leakage.

Create a new, empty LadsData database with the schema committed in this repo:

```bash
node scripts/db/createLadsDataDb.js db/LadsData.db
```

The target must not already exist. This creates tables and indexes only; it does
not copy leagues, matches, users, or other data. To refresh the schema snapshot
from the current database after a schema change:

```bash
node scripts/db/exportLadsDataSchema.js db/LadsData.db scripts/db/ladsData.schema.sql
```

The exporter reads through SQLite, including committed WAL changes.

Historical league winners are imported into `LeagueSeasons` automatically when the
updated server starts. The import uses the same final-match winner the older league
pages already displayed, creates ended season records, and preserves existing saved
champions and the active league. Rerunning it adds no duplicates. Known historical
end dates are preserved; missing dates remain unknown.

To preview or apply the same backfill manually against an existing initialized database:

```bash
node scripts/db/backfillLeagueChampions.js db/LadsData.db
node scripts/db/backfillLeagueChampions.js db/LadsData.db --apply
```

The manual apply creates a SQLite backup beside the database before writing. No full
database upload is needed; the normal deployment restart runs this backfill in production.

The server also creates `ChampionshipRosterPlayers` and the league/match/player
lookup indexes it needs automatically on startup.
Under **Admin → Champions**, select a completed legacy season and its champion,
then move five players into **Active players** and save. Candidates come only
from that team's matches in that season. The saved five receive championship
trophies instead of using the inferred majority-appearance lineup. Selections
are stored per season and team, and changes are audited. Seasons with finalized
signup rosters continue to use those rosters. No manual migration is required.

After deploying the updated code, add the base rulebook to the existing
production database. The deploy workflow already restarts PM2. From the
project directory on the server, preview the import, apply it, then verify
that no items remain to be added:

```bash
cd /root/LeagueOfLads
node scripts/db/importRulebook2024.js /root/LeagueOfLads/db/LadsData.db
node scripts/db/importRulebook2024.js /root/LeagueOfLads/db/LadsData.db --apply
node scripts/db/importRulebook2024.js /root/LeagueOfLads/db/LadsData.db
```

The importer creates the `SiteRules` table if needed, backs up the database
before changing it, and adds the rulebook's headers and rules in source order.
It preserves existing matching entries and can be rerun without duplicating
them. The final preview should report `"add": 0`. Reload the public Rules page
and the admin Rules tab to see the imported entries.

Before starting the updated server in production, run the additive preseason
admin migration against its existing database:

```bash
node scripts/db/migratePreseasonAdmin.js /root/LeagueOfLads/db/LadsData.db
```

The script creates a SQLite backup beside the database before changing it.
It adds `LeagueTeamNames`, `GroupResultOverrides`, `LeagueRosterEntries`, and
the roster name index. Existing league, group, team, and match rows are kept.
Running it again reports that the schema is already present.

Before starting the server version that uses database-backed admin access, seed
the current admin in production:

```bash
node scripts/db/migrateAdmins.js /root/LeagueOfLads/db/LadsData.db <current-admin-account-id> "Admin Name"
```

The ID is the Steam account ID previously used as `ADMIN_ID`, rather than the
64-bit Steam ID. This migration creates `Admins` with `AdminPlayerId`,
`AdminPlayerName`, and boolean `HeadAdmin`, then inserts that admin as a head
admin. It backs up the database first and can be rerun safely. The new server
checks this table for every `/admin` request. Admin Management in the portal
shows the current list to every admin. Head admins can select an existing
`PlayerInfo` player by account ID or display name, choose their role, and change existing
admins between Admin and Head Admin. They can also add an account manually by
Steam account ID and name if it is absent from `PlayerInfo`. Head admins can
remove non-head admins.
There is no cap on head admins; the final head admin cannot be demoted.

The active league's preseason roster is entered in the Admin tab before teams
have Dota TeamIds. After each nightly match load, `populateTeamNames.js` links
newly played teams to roster rows only when their names match uniquely after
case and whitespace normalization. Matches still load when names differ. Admins
can link those rows manually in the group setup table using a team ID from a
played match. Tiebreakers and playoffs require every preseason row to be linked
or removed.

The root shell wrappers remain at the project root because server cron/PM2 jobs
may call those paths directly.

Before deploying compact live snapshots, stop the live poller and server, then run:

```bash
node scripts/db/migrateCompactLiveSnapshots.js /root/LeagueOfLads/db/LadsData.db
```

The migration backs up the database, moves snapshot team names into columns,
removes the raw API response from `LiveMatchSnapshots` and
`LiveMatchCurrentState`, and compacts the database file. Player and draft data
remain in their existing tables. Check the site after restarting, then remove the migration's
`.bak` file when the backup is no longer needed to reclaim that space.
