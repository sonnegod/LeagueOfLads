import db from './database.js';

const playoffGames = db.getPlayoffGames(18089);

let startingMatchups = [
    {Team1: 9238661,Team2: 9767237,Round: 1,Bracket: 'U'},
    {Team1: 9395827,Team2: 9792183,Round: 1,Bracket: 'U'},
    {Team1: 9652256,Team2: 9774569,Round: 1,Bracket: 'U'},
    {Team1: 9245820,Team2: 9766828,Round: 1,Bracket: 'U'},
    {Team1: 9782141,Team2: 9774637,Round: 1,Bracket: 'L'},
    {Team1: 9814566,Team2: 9790113,Round: 1,Bracket: 'L'},
    {Team1: 9791079,Team2: 9790118,Round: 1,Bracket: 'L'},
    {Team1: 9781672,Team2: 9345476,Round: 1,Bracket: 'L'},
    {Team1: 9782150,Team2: 9766518,Round: 1,Bracket: 'L'},
    {Team1: 9728745,Team2: 9414757,Round: 1,Bracket: 'L'},
    {Team1: 9517485,Team2: 9511222,Round: 1,Bracket: 'L'},
    {Team1: 7424422,Team2: 8998481,Round: 1,Bracket: 'L'}
];


const bracket = buildPlayoffBracket(startingMatchups,playoffGames);

console.log(bracket);

// Helper to normalize a matchup key
function pairKey(a, b) {
  return [a, b].sort().join('-');
};

// Build double elimination bracket from match data
function buildPlayoffBracket(startingMatchups, playoffGames) {
  // Sort by match ID for consistent ordering
  playoffGames.sort((a, b) => a.MatchId - b.MatchId);

  const seriesList = [];
  const ongoing = new Map(); // pairKey → { matches, wins }
  let x = 0;

  for (const game of playoffGames) {
    const key = pairKey(game.TeamRad, game.TeamDire);
    if (!ongoing.has(key)) {
      ongoing.set(key, { matches: [], wins: {} });
    }
    const entry = ongoing.get(key);
    entry.matches.push(game);
    entry.wins[game.WinnerId] = (entry.wins[game.WinnerId] || 0) + 1;

    // Determine win condition: 2 for Bo3, 3 for Bo5
    const isGrandFinal = ongoing.has(key) &&
                     seriesList.some(s => pairKey(s.Team1, s.Team2) === key) &&
                     playoffGames.slice(-3).some(g => pairKey(g.TeamRad, g.TeamDire) === key);

    const neededWins = isGrandFinal ? 3 : 2;
    const hasWinner = Object.values(entry.wins).some(w => w >= neededWins);

    // Once a team wins enough, record the series
    if (hasWinner) {
      const [winnerId, winCount] = Object.entries(entry.wins)
        .sort((a, b) => b[1] - a[1])[0];
      const loserId = game.TeamRad === Number(winnerId)
        ? game.TeamDire
        : game.TeamRad;

      seriesList.push({
        id: x,
        Team1: game.TeamRad,
        Team1Name : game.Team1,
        Team2: game.TeamDire,
        Team2Name : game.Team2,
        WinnerId: Number(winnerId),
        LoserId: Number(loserId),
        Games: entry.matches.map(m => m.MatchId),
        BestOf: winCount >= 3 ? 5 : 3,
        winnerTo: null,
        loserTo: null
      });

      

      ongoing.delete(key);
    }
    x++;
  }

    for (let i = 0; i < seriesList.length; i++) {
        const m = seriesList[i];

        // find the *next* match (with higher ID/order) where the same team appears
        const nextWinnerMatch = seriesList.find(
            n =>
            n.id > m.id && // only look at later matches
            (n.Team1 === m.WinnerId || n.Team2 === m.WinnerId)
        );

        const nextLoserMatch = seriesList.find(
            n =>
            n.id > m.id &&
            (n.Team1 === m.LoserId || n.Team2 === m.loLoserIdser)
        );

        m.winnerTo = nextWinnerMatch ? nextWinnerMatch.id : null;
        m.loserTo = nextLoserMatch ? nextLoserMatch.id : null;
    }
  // Bracket progression simulation
  const bracketComplete = inferBracketInfo(seriesList);

  console.log(bracketComplete);

  return { bracket, seriesList};
};

function inferBracketInfo(seriesList) {
  const matchMap = Object.fromEntries(seriesList.map(m => [m.id, m]));
  const finals = seriesList.find(m => !m.winnerTo);
  // Temporary maps
  const bracketType = {};
  const roundNumber = {};

  // Grand Finals
  if (finals) {
    bracketType[finals.id] = 'GF';
    roundNumber[finals.id] = 1;
  }

  // Walk backwards to tag matches as Upper or Lower
  const visited = new Set();
  function tagMatch(matchId, type, round) {
    if (!matchId || visited.has(matchId)) return;
    visited.add(matchId);

    const m = matchMap[matchId];
    if (!m) return;

    bracketType[m.id] = type;
    roundNumber[m.id] = Math.max(roundNumber[m.id] || 0, round);

    // Tag previous matches that led into this one
    const incoming = seriesList.filter(
      x => x.winnerTo === m.id || x.loserTo === m.id
    );
    for (const prev of incoming) {
      if (prev.loserTo === null) {
        tagMatch(prev.id, 'L', round + 1);
      } else {
        tagMatch(prev.id, type === 'GF' ? 'U' : type, round + 1);
      }
    }
  }

  if (finals) tagMatch(finals.id, 'GF', 1);

  // Apply inferred info back into seriesList
  return seriesList.map(m => ({
    ...m,
    Bracket: bracketType[m.id] || 'U',
    Round: roundNumber[m.id] || 1
  }));
};


function buildBracketTree(seriesList) {
  const finals = seriesList.find(m => !m.winnerTo);

  function buildNode(match) {
    if (!match) return null;

    const children = seriesList
      .filter(x => x.winnerTo === match.id || x.loserTo === match.id)
      .map(buildNode);

    return {
      id: match.id,
      name: `Match ${match.id}`,
      bracket: match.Bracket,
      round: match.Round,
      team1: match.team1,
      team2: match.team2,
      winner: match.winner,
      loser: match.loser,
      children
    };
  }

  return buildNode(finals);
}