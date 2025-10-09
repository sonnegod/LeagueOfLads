import db from './database.js';

const legacyLeagues = [
    12300,
    12671,
    13177,
    13450,
    13807,
    14211,
    14648,
    14993,
    15482,
    15862,
    16330,
    16960,
    17636,
    18089
]
for(const league of legacyLeagues)
    assignGroups(league);
function assignGroups(leagueId) {
    const boundary = db.db.prepare(`
        SELECT GroupEndMatchId 
        FROM LeagueStageBoundaries 
        WHERE LeagueId = ?
    `).get(leagueId);

    const matches = db.db.prepare(`
        SELECT TeamRad, TeamDire
        FROM MatchTeam mt
        JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
        WHERE ml.LeagueId = ?
        AND ml.MatchId <= COALESCE(?, ml.MatchId)
    `).all(leagueId, boundary?.GroupEndMatchId);

    // Build adjacency map
    const graph = {};
    for (const { TeamRad, TeamDire } of matches) {
        const rad = TeamRad.toString();
        const dire = TeamDire.toString();

        if (!graph[rad]) graph[rad] = new Set();
        if (!graph[dire]) graph[dire] = new Set();
        graph[rad].add(dire);
        graph[dire].add(rad);
    }

    
    // Find connected components (groups)
    const visited = new Set();
    let groupNum = 1;

    for (const teamId of Object.keys(graph)) {
        if (visited.has(teamId)) continue;
        // BFS/DFS to find all connected teams
        const queue = [teamId];
        const component = [];
        visited.add(teamId);
        console.log('------')
        console.log
        console.log('------')

        console.log(visited);
        console.log('------');

        console.log(groupNum);
        while (queue.length > 0) {
            const current = queue.pop();
            component.push(current);
            console.log('Component')
            console.log(component);
            console.log('-------')
            for (const neighbor of graph[current]) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }

        // Insert all teams from this component as the same group
        const insert = db.db.prepare(`
            INSERT INTO LeagueGroups (LeagueId, TeamId, GroupName)
            VALUES (?, ?, ?)
        `);
        for (const id of component) {
            insert.run(leagueId, id, groupNum);
        }

        groupNum++;
    }
}
