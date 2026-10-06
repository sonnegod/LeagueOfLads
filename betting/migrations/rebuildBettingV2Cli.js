import { rebuildBettingV2, RESET_CONFIRMATION } from './rebuildBettingV2.js';

const args = process.argv.slice(2);
const usage = `Stop the server and scheduled betting jobs before a confirmed reset.\nUsage:\n  node betting/migrations/rebuildBettingV2Cli.js --db <absolute-existing-Betting.db-path> --dry-run\n  node betting/migrations/rebuildBettingV2Cli.js --db <absolute-existing-Betting.db-path> --confirm-reset ${RESET_CONFIRMATION} --services-stopped`;

if (args[0] !== '--db' || !args[1] ||
    !((args.length === 3 && args[2] === '--dry-run') ||
      (args.length === 5 && args[2] === '--confirm-reset' &&
        args[3] === RESET_CONFIRMATION && args[4] === '--services-stopped'))) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const result = await rebuildBettingV2({
      dbPath: args[1],
      dryRun: args[2] === '--dry-run',
      confirmation: args[3],
    });
    if (result.alreadyV2) {
      console.log(`Betting v2 schema already present: ${result.path}`);
    } else if (result.dryRun) {
      console.log(`Dry run for ${result.path}: ${JSON.stringify(result.counts)}`);
      console.log('Confirmed rebuild would reset every wallet to 10000 and replace all markets, bets, and transaction history.');
      console.log('Stop the server and scheduled betting jobs before a confirmed reset.');
      const quotedPath = process.platform === 'win32'
        ? `'${result.path.replaceAll("'", "''")}'`
        : `'${result.path.replaceAll("'", "'\\''")}'`;
      console.log(`Then run: node betting/migrations/rebuildBettingV2Cli.js --db ${quotedPath} --confirm-reset ${RESET_CONFIRMATION} --services-stopped`);
    } else {
      console.log(`Backup created: ${result.backupPath}`);
      console.log(`Betting v2 rebuilt: ${result.path}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
