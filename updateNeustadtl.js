import db from './database.js';

function getGroupOpponents(groupTeams, teamId) {
  return groupTeams.filter(t => t.TeamId !== teamId);
}

function getResults(teamA,teamB){
    return db.getResults(teamA,teamB);
}

function scoreMatchSet(teamId, results, opponentMapWins) {
  if (results.length === 0) return 0;

  let wins = 0;
  let losses = 0;

  results.forEach(m => {
    if (m.WinnerId === teamId) wins++;
    else losses++;
  });

  if (wins === 2) return 2*opponentMapWins;  // 2–0
  if (wins === 1 && losses === 1) return opponentMapWins; // 1–1
  return 0; // 0–2
}

function computeNeustadtl() {
  const raw = db.getActiveTeamsGroups();

  // Separate by group
  const groups = {};
  raw.forEach(r => {
    if (!groups[r.GroupId]) groups[r.GroupId] = [];
    groups[r.GroupId].push(r);
  });

  const standings = [];

  for (const groupId in groups) {
    const groupTeams = groups[groupId];

    groupTeams.forEach(team => {
      let neustadtl = 0;

      const opponents = getGroupOpponents(groupTeams, team.TeamId);

      opponents.forEach(opp => {
        const results = getResults(team.TeamId, opp.TeamId);

        neustadtl += scoreMatchSet(team.TeamId, results, opp.Wins);
      });

      standings.push({
        TeamId: team.TeamId,
        Neustadtl: neustadtl
      });
    });
  }

  return standings;
}


function main() {
  console.log("Computing nightly Neustadtl...");

  const standings = computeNeustadtl();

  db.updateNeustadtl(standings);

  console.log("Neustadtl Scores Updated:");
}


main();