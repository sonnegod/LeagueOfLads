import db from './database.js';
import { getLiveLeagueMatches, normalizeLiveMatch } from './pollLiveMatchData.js';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getLatestSnapshot() {
  return db.queryDatabase(`
    SELECT SnapshotId, MatchId, LeagueId, ResponseJson
    FROM LiveMatchSnapshots
    ORDER BY SnapshotId DESC
    LIMIT 1
  `)[0];
}

function getSnapshotById(snapshotId) {
  return db.queryDatabase(`
    SELECT SnapshotId, MatchId, LeagueId, ResponseJson
    FROM LiveMatchSnapshots
    WHERE SnapshotId = ?
  `, [snapshotId])[0];
}

function getAllSnapshots() {
  return db.queryDatabase(`
    SELECT SnapshotId, MatchId, LeagueId, ResponseJson
    FROM LiveMatchSnapshots
    ORDER BY SnapshotId ASC
  `);
}

function countRows(tableName, columnName, value) {
  return db.queryDatabase(`
    SELECT COUNT(*) AS Count
    FROM ${tableName}
    WHERE ${columnName} = ?
  `, [value])[0]?.Count || 0;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getDraftItemCount(draftRow) {
  if (!draftRow) return 0;
  return [
    parseJson(draftRow.RadiantPicksJson, []),
    parseJson(draftRow.RadiantBansJson, []),
    parseJson(draftRow.DirePicksJson, []),
    parseJson(draftRow.DireBansJson, []),
  ].reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);
}

function getNormalizedDraftItemCount(snapshotId) {
  return getDraftItemCount(db.queryDatabase(`
    SELECT RadiantPicksJson, RadiantBansJson, DirePicksJson, DireBansJson
    FROM LiveMatchSnapshotDraft
    WHERE SnapshotId = ?
  `, [snapshotId])[0]);
}

function printSnapshotReport(snapshotId, matchId) {
  console.log(`Snapshot ${snapshotId} normalized for match ${matchId}.`);
  console.log(`LiveMatchCurrentPlayer rows: ${countRows('LiveMatchCurrentPlayer', 'MatchId', matchId)}`);
  console.log(`LiveMatchCurrentDraft rows: ${countRows('LiveMatchCurrentDraft', 'MatchId', matchId)}`);
  console.log(`LiveMatchSnapshotPlayer rows: ${countRows('LiveMatchSnapshotPlayer', 'SnapshotId', snapshotId)}`);
  console.log(`LiveMatchSnapshotDraft rows: ${countRows('LiveMatchSnapshotDraft', 'SnapshotId', snapshotId)}`);

  console.table(db.queryDatabase(`
    SELECT Team, AccountId, PlayerName, HeroId, Kills, Deaths, Assists, LastHits, NetWorth
    FROM LiveMatchSnapshotPlayer
    WHERE SnapshotId = ?
    ORDER BY Team ASC, PlayerSlot ASC, AccountId ASC
  `, [snapshotId]));

  const draftRow = db.queryDatabase(`
    SELECT SnapshotId, MatchId, RadiantPicksJson, DirePicksJson, RadiantBansJson, DireBansJson
    FROM LiveMatchSnapshotDraft
    WHERE SnapshotId = ?
  `, [snapshotId])[0];

  if (draftRow) {
    console.table([{
      SnapshotId: draftRow.SnapshotId,
      MatchId: draftRow.MatchId,
      RadiantPicks: parseJson(draftRow.RadiantPicksJson, []).length,
      DirePicks: parseJson(draftRow.DirePicksJson, []).length,
      RadiantBans: parseJson(draftRow.RadiantBansJson, []).length,
      DireBans: parseJson(draftRow.DireBansJson, []).length,
    }]);
  }
}

function normalizeSavedSnapshot(snapshot) {
  if (!snapshot) {
    throw new Error('No LiveMatchSnapshots row found to replay.');
  }

  const game = JSON.parse(snapshot.ResponseJson);
  const matchData = normalizeLiveMatch(game, snapshot.LeagueId);
  if (!matchData) {
    throw new Error(`Snapshot ${snapshot.SnapshotId} did not contain a valid match_id.`);
  }

  db.replaceLiveMatchSnapshotPlayers(snapshot.SnapshotId, matchData.Players || []);
  db.replaceLiveMatchSnapshotDraft(snapshot.SnapshotId, matchData.Draft || []);

  return matchData;
}

function replaySavedSnapshot(snapshot) {
  const matchData = normalizeSavedSnapshot(snapshot);

  db.upsertLiveMatchCurrentState(matchData);
  db.replaceLiveMatchCurrentPlayers(matchData.MatchId, matchData.Players || []);
  db.replaceLiveMatchCurrentDraft(matchData.MatchId, matchData.Draft || []);

  printSnapshotReport(snapshot.SnapshotId, matchData.MatchId);
}

function replayAllSavedSnapshots() {
  const snapshots = getAllSnapshots();
  if (!snapshots.length) {
    throw new Error('No LiveMatchSnapshots rows found to replay.');
  }

  let latestMatchData = null;
  let latestSnapshot = null;

  for (const snapshot of snapshots) {
    latestMatchData = normalizeSavedSnapshot(snapshot);
    latestSnapshot = snapshot;
  }

  db.upsertLiveMatchCurrentState(latestMatchData);
  db.replaceLiveMatchCurrentPlayers(latestMatchData.MatchId, latestMatchData.Players || []);
  db.replaceLiveMatchCurrentDraft(latestMatchData.MatchId, latestMatchData.Draft || []);

  console.log(`Normalized ${snapshots.length} saved snapshot(s).`);
  printSnapshotReport(latestSnapshot.SnapshotId, latestMatchData.MatchId);
}

function getRawDraftRowCount(snapshot) {
  const game = JSON.parse(snapshot.ResponseJson);
  return [
    game.scoreboard?.radiant?.picks,
    game.scoreboard?.radiant?.bans,
    game.scoreboard?.dire?.picks,
    game.scoreboard?.dire?.bans,
  ].reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);
}

function verifySnapshotDraftCounts() {
  const snapshots = getAllSnapshots();
  const rows = snapshots
    .map((snapshot) => ({
      SnapshotId: snapshot.SnapshotId,
      RawDraftRows: getRawDraftRowCount(snapshot),
      NormalizedDraftItems: getNormalizedDraftItemCount(snapshot.SnapshotId),
    }))
    .filter((row) => row.RawDraftRows || row.NormalizedDraftItems);

  console.table(rows);
}

async function recordOneApiSnapshot() {
  const activeLeagueId = db.getActiveLeague()?.[0]?.LeagueId;
  if (!activeLeagueId) {
    console.log('No active league found. Skipping Steam API call.');
    return;
  }

  const games = await getLiveLeagueMatches(activeLeagueId);
  if (!games.length) {
    console.log(`Steam API returned no live games for active league ${activeLeagueId}.`);
    return;
  }

  const matchData = normalizeLiveMatch(games[0], activeLeagueId);
  if (!matchData) {
    throw new Error('Steam API returned a game without a valid match_id.');
  }

  const changed = db.recordLiveMatchSnapshot(matchData);
  console.log(`Recorded API match ${matchData.MatchId}. Snapshot changed: ${changed ? 'yes' : 'no'}.`);
  console.log(`LiveMatchCurrentPlayer rows: ${countRows('LiveMatchCurrentPlayer', 'MatchId', matchData.MatchId)}`);
  console.log(`LiveMatchCurrentDraft rows: ${countRows('LiveMatchCurrentDraft', 'MatchId', matchData.MatchId)}`);
}

async function main() {
  if (hasFlag('--api')) {
    await recordOneApiSnapshot();
    return;
  }

  if (hasFlag('--all')) {
    replayAllSavedSnapshots();
    return;
  }

  if (hasFlag('--verify')) {
    verifySnapshotDraftCounts();
    return;
  }

  const snapshotArg = getArgValue('--snapshot');
  const snapshot =
    snapshotArg && snapshotArg !== 'latest'
      ? getSnapshotById(Number(snapshotArg))
      : getLatestSnapshot();

  replaySavedSnapshot(snapshot);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
