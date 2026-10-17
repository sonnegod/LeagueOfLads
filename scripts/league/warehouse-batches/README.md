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
skipped. A season interrupted at runtime stays in that file. Existing invalid
results remain excluded, and unavailable parsed data can produce partial imports.

The shared [settings](../warehouseBackfill.json) cap batch-worker requests at
2,500 per UTC day, retain a 300-request reserve against OpenDota's observed daily
allowance, and wait/retry minute throttles. Five retry requests per season are
reserved. Counters persist beside the target database across restarts. Other jobs
may consume provider quota and cause an early stop even if this file fits on paper.

The [full script guide](../../README.md#numbered-whole-season-batches) describes
reports, retry limits, exit codes and recovery.
