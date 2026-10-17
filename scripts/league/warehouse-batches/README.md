# Historical EDW batches

Run from the repository root after installing the updated dependencies/schema.
Both files contain multiple **whole seasons**. No season appears in two files.

| File | Seasons | Match requests before any completed imports or exclusions | Retry reserve |
| --- | --- | ---: | ---: |
| [batch-01.json](batch-01.json) | 21, 20, 19, 18, 17, 16, 15 | 2,292 | 35 |
| [batch-02.json](batch-02.json) | 14, 13, 12, 11, 10, 9, 8, 7, 6, 5 | 2,380 | 50 |

## First day

Preview (no API requests or data changes):

```bash
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-01.json
```

Run:

```bash
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-01.json --apply
```

For a local load without a backup, append `--no-backup`.

Open `validation.md` in the printed `Logs/warehouse-backfill/` directory. Review
excluded matches, partial coverage and any discrepancies in the per-season JSONs.

## Another day, after review

```bash
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-02.json
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-02.json --apply
```

The runner stops after the chosen file. It never starts the next file itself.
If interrupted or limited by OpenDota, rerun the same file; successful imports are
skipped. A season interrupted at runtime stays in that file. Remakes and records
with identical teams remain excluded. Stale winner references are enriched with
the original result unchanged and listed separately for review. Unavailable parsed
data can produce partial imports.
Individual match failures are recorded for review while the rest of the batch
continues. Protected-data changes or failed integrity/source reconciliation still
stop the run. The readable report lists match errors; `summary.json` includes
`reviewRequired`. A completed batch with match errors returns exit code 1 for review
after processing its seasons.

The shared [settings](../warehouseBackfill.json) cap batch-worker requests at
2,500 per UTC day, retain a 300-request reserve against OpenDota's observed daily
allowance, and wait/retry minute throttles. Five retry requests per season are
reserved. Counters persist beside the target database across restarts. Other jobs
may consume provider quota and cause an early stop even if this file fits on paper.

The [full script guide](../../README.md#numbered-whole-season-batches) describes
reports, retry limits, exit codes and recovery.

## Repair incomplete historical records

To refresh existing core match records when the incoming response is more
complete, add `--repair-incomplete`. Preview first (no API calls or writes):

```bash
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-01.json --repair-incomplete
node scripts/league/backfillWarehouse.js db/LadsData.db scripts/league/warehouse-batches/batch-01.json --repair-incomplete --apply
```

This mode requires a completed response with ten distinct, identifiable players,
valid sides/heroes, duration, and core stats for every player. A repair requires
fewer than ten distinct stored players, or more populated incoming core stat
cells than the stored record. Zero is a real value, not a missing stat. A changed
winner or hero by itself does not establish greater completeness.

A qualifying repair refreshes player identities, heroes, available stats,
player winners, memberships, match winner/duration, available draft data and EDW
detail in one transaction. Source sides map onto **existing warehouse team IDs**,
including substitute IDs already corrected by admins. League, group, stage,
series, rehost status and existing date assignments remain intact. Group standings
and Neustadtl are rebuilt using existing group-result overrides if the winner
changes. Missing optional stats, draft data or parsed sections do not erase
richer existing data for the same players/heroes.

Recorded participant conflicts and core-deficient records can be selected
immediately in this explicit mode, including otherwise-ready imports. The normal
runner's cooldown/skip policy is unchanged. Completed, fully populated core
records are still skipped. Preview recalculates whether the whole file fits the
remaining shared daily allowance; pacing, reserve, lock and backup behavior are
the same as ordinary batches.

The report lists each repair. Exact before/after original rows are appended to
`repairs.jsonl` after each successful repair, and included in `repairs.json` and
`summary.json` at completion. Validation accounts for these exact changes; it
still rejects unrelated edits and unexpected changes to repaired rows. Existing
`Logins`/audit activity can still fail the baseline check as before.

Deleted matches are not rediscovered or restored. They require an explicit
recovery of season/team/series metadata from backups before this runner can
select them. No requests or production repairs are run by deployment itself;
an existing PM2 batch entry still needs the new argument to enable repair mode.
