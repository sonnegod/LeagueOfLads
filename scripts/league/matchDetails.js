import { ingestWarehouseMatch } from '../../config/warehouseIngestion.js';
import { ingestDraftTelemetry } from '../../config/draftTelemetry.js';
import { withSqliteBusyRetry } from '../../config/warehouseConnection.js';
import db from '../../database.js';
import apiUrl from '../../apiURL.js';
import { startSourceLoad, finishSourceLoad, recordMatchStart } from '../../analytics/sourceMetadata.js';

let matchDetailCallsToday = 0;
const MAX_CALLS_PER_DAY = 2000;
const MIN_INTERVAL_MS = 1000; // 1 call per second

const knownPlayers = new Set(db.preloadedData.users.map(p => p.PlayerId));
const leagueId = db.getActiveLeague()?.[0]?.LeagueId;
const sourceRunId = startSourceLoad(db.db, 'match_details');

try {
  if (!leagueId) {
    console.log("No active league. Skipping match detail load.");
    finishSourceLoad(db.db, sourceRunId);
  } else {
    console.log("Beginning match detail load");

    const unparsedMatches = db.db.prepare(`SELECT ml.MatchId FROM MatchLeague ml WHERE ml.LeagueId = ?
      AND NOT EXISTS (SELECT 1 FROM MatchPlayer mp WHERE mp.MatchId = ml.MatchId) ORDER BY ml.MatchId`).all(leagueId);
    console.log(`${unparsedMatches.length} Matches that need to be parsed by Open Dota`);

    const currentStage = db.getStage()?.[0]?.Stage || 'g';
    const result = await getMatchDetails(unparsedMatches, currentStage, leagueId);
    finishSourceLoad(db.db, sourceRunId, result);
    if (result.failures) process.exitCode = 1;
  }
} catch {
    finishSourceLoad(db.db, sourceRunId, { failed: true, failures: 1 });
    console.error('Match detail load failed; source freshness was not advanced.');
    process.exitCode = 1;
}

async function getMatchDetails(matches, currentStage, leagueId){
    const badMatches = [];
    let failures = 0;
    let records = 0;

    for(const match of matches){
        if (matchDetailCallsToday >= MAX_CALLS_PER_DAY) {
            console.warn("API daily limit reached. Stopping further calls.");
            failures += 1;
            break;
        }

        const matchId = match.MatchId;
        
        await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS)); // throttle per call

        try {
            const response = await fetch(apiUrl.baseMatchData + match.MatchId, { method: 'GET' });
            if (!response.ok) throw new Error(`OpenDota returned ${response.status}`);
            const data = await response.json();
            if (Number(data.match_id) !== Number(matchId)) throw new Error('Mismatched match ID');
            if (!Array.isArray(data.players) || typeof data.radiant_win !== 'boolean' || !data.start_time) {
                throw new Error('Incomplete match detail response');
            }

            matchDetailCallsToday++;
            console.log(`(${matchDetailCallsToday}) Match ${match.MatchId} details pulled.`);
            recordMatchStart(db.db, matchId, data.start_time, 'opendota_details');

            //indicates that this match got remade
            if(data.radiant_score === 0 && data.dire_score === 0){
                db.deleteRemakeMatch(match.MatchId);
            }
            else{
              let committedPlayers = [];
              db.db.transaction(() => {
                if(data.picks_bans && db.insertPickBanData(match.MatchId, data.picks_bans) !== 1) {
                    throw new Error('Could not persist draft details');
                }

                // Insert new players (optimized from earlier step) here...
                const newPlayers = [];


                if(data.players.length !== 10 || new Set(data.players.map(player => player.account_id)).size !== 10
                    || data.players.some(player => !Number.isSafeInteger(player.account_id) || player.account_id <= 0))
                {
                    badMatches.push({
                        match_id: match.MatchId,
                        player_number: data.players.length,
                    }); 
                    throw new Error('Match participants are incomplete');
                }

                for (const player of data.players) {
                    const accountId = player.account_id;

                    if (accountId && !knownPlayers.has(accountId)) {
                        newPlayers.push({
                            player_id: accountId,
                            player_name: player.personaname || '', // fallback to null if not present
                        });
                    }
                    if (accountId !== null && accountId !== undefined) {
                        let teamCode = null;

                        if (player.player_slot >= 0 && player.player_slot <= 4) {
                            teamCode = 'R'; // Radiant
                        } else if (player.player_slot >= 128 && player.player_slot <= 132) {
                            teamCode = 'D'; // Dire
                        }

                        if (teamCode) {
                            if (db.InsertMatchTeamPlayer(matchId, accountId, teamCode) !== 1) {
                                throw new Error('Could not persist team/player assignment');
                            }
                        } else {
                            throw new Error('Invalid player side');
                        }
                    }
                }

                if (newPlayers.length > 0) {
                    if (db.insertNewPlayers(newPlayers) !== 1) throw new Error('Could not persist players');
                    committedPlayers = newPlayers;
                }

                const winTeamId = data.radiant_win
                    ? data.radiant_team_id
                    : data.dire_team_id;

                const loseTeamId = data.radiant_win
                    ? data.dire_team_id
                    : data.radiant_team_id;

                if (db.insertMatchDetailsPlayer(match.MatchId, data.players) !== 1
                    || db.insertTeamWin(match.MatchId, winTeamId) !== 1
                    || db.insertDuration(match.MatchId, data.duration) !== 1) {
                    throw new Error('Could not persist match details');
                }

                //creating series
                // Link the series to the actual match day, not the processing day.
                const matchDate = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'America/New_York',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).format(new Date(data.start_time * 1000));

                
                try {
                    // 1. Get the Series ID (Finds existing one for today, or creates new one)
                    const seriesId = db.getOrCreateSeriesId(
                        data.dire_team_id, 
                        data.radiant_team_id, 
                        currentStage, 
                        leagueId,
                        matchDate
                    );

                    // 2. Link the Match to the Series
                    const resultMatch = db.insertSeriesMatch(seriesId, match.MatchId, matchDate);
                    
                    
                    if(resultMatch === 2) {
                        throw new Error('Could not persist series link');
                    }

                    // 3. Handle Standings
                    if (currentStage === 'g') {
                        db.insertLeagueStanding(match.MatchId, winTeamId, loseTeamId);
                    }

                } catch (err) {
                    console.error(`CRITICAL FAILURE processing match ${match.MatchId}:`, err);
                    console.error(`Series link failed for match ${match.MatchId}.`);
                    throw err;
                }
              })();
              for (const player of committedPlayers) knownPlayers.add(player.player_id);
              // Enrichment owns its transactions; retry only after the core match has committed.
              try { await withSqliteBusyRetry(() => ingestWarehouseMatch(db.db, data, { expectedMatchId: matchId })); }
              catch(e) { console.warn(`Warehouse enrichment ${matchId}:`, e.message); }
              try { ingestDraftTelemetry(db.db, data); } catch(e) { console.warn('Draft telemetry:', e.message); }
            }
            records += 1;
        } catch (err) {
            failures += 1;
            console.error(`Failed to fetch match ${match.MatchId}:`, err);
        }
    }


    if(badMatches.length > 0)
    {
        console.log(`Inserted ${badMatches.length} with info:`)
        for(const match of badMatches)
        {
            console.log(`Match: ${match.match_id} has ${match.num_players}`);
        }
    }
    return { records, failures };
}
