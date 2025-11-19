import db from './database.js';

function getGroupOpponents(groupTeams, teamId) {
  return groupTeams.filter(t => t.TeamId !== teamId);
}

function getResults(teamA,teamB){
    return db.getResults(teamA,teamB);
}

function scoreMatchSet(teamId, results) {
  if (results.length === 0) return 0;

  let wins = 0;
  let losses = 0;

  results.forEach(m => {
    if (m.WinnerId === teamId) wins++;
    else losses++;
  });

  if (wins === 2) return 2;  // 2–0
  if (wins === 1 && losses === 1) return 1; // 1–1
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
        if(team.TeamId === 9906253)
                        console.log(opponents);

      opponents.forEach(opp => {
        const results = getResults(team.TeamId, opp.TeamId);
        if(team.TeamId === 9906253)
            console.log(results);
        neustadtl += scoreMatchSet(team.TeamId, results);
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
  console.table(standings);
}


main();