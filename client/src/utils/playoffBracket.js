const getWinner = (match) => {
  if (!match?.team1Id || !match?.team2Id) return null;

  const team1Score = Number(match.team1Score || 0);
  const team2Score = Number(match.team2Score || 0);
  if (team1Score === team2Score) return null;

  return team1Score > team2Score
    ? { id: match.team1Id, name: match.team1Name }
    : { id: match.team2Id, name: match.team2Name };
};

const hasResult = (match) => {
  const team1Score = Number(match.team1Score || 0);
  const team2Score = Number(match.team2Score || 0);
  return Boolean(match.seriesId) || team1Score !== 0 || team2Score !== 0;
};

const rewriteLowerTarget = (target, roundOffset) => {
  if (!target?.startsWith('lb-r')) return target;

  return target.replace(/^lb-r(\d+)-/, (_, round) => (
    `lb-r${Number(round) + roundOffset}-`
  ));
};

export const generatePlayoffBracket = (teams) => {
  const ubTeams = teams.filter((team) => team.Bracket === 'upper');
  const lbTeams = teams.filter((team) => team.Bracket === 'lower');
  const ubCount = ubTeams.length;
  const lbStartCount = lbTeams.length;
  const ubRounds = Math.ceil(Math.log2(ubCount));
  const equalStartingBrackets = ubCount === lbStartCount;
  const firstDropRound = equalStartingBrackets ? 2 : 3;
  const lbRounds = firstDropRound + ((ubRounds - 1) * 2);

  const structure = {
    upperBracket: [],
    lowerBracket: [],
    grandFinals: []
  };

  for (let round = 1; round <= ubRounds; round++) {
    const matchCount = ubCount / Math.pow(2, round);
    const matches = [];

    for (let matchNum = 1; matchNum <= matchCount; matchNum++) {
      matches.push({
        id: `ub-r${round}-m${matchNum}`,
        bracket: 'upper',
        round,
        matchNum,
        team1Id: null,
        team1Name: null,
        team2Id: null,
        team2Name: null,
        loserTo: `lb-r${firstDropRound + ((round - 1) * 2)}-m${matchNum}`,
        winnerTo: round < ubRounds
          ? `ub-r${round + 1}-m${Math.ceil(matchNum / 2)}`
          : 'gf-m1',
        winnerToSlot: matchNum % 2 === 1 ? 1 : 2,
        team1Score: 0,
        team2Score: 0,
        seriesId: null
      });
    }

    structure.upperBracket.push({ round, matches });
  }

  let currentMatchCount = lbStartCount / 2;

  for (let round = 1; round <= lbRounds; round++) {
    const isDropRound = round >= firstDropRound
      && (round - firstDropRound) % 2 === 0;

    if (round > 1 && !isDropRound) {
      currentMatchCount /= 2;
    }

    if (currentMatchCount < 1) break;

    const matches = [];
    for (let matchNum = 1; matchNum <= currentMatchCount; matchNum++) {
      const match = {
        id: `lb-r${round}-m${matchNum}`,
        bracket: 'lower',
        round,
        matchNum,
        team1Id: null,
        team1Name: null,
        team2Id: null,
        team2Name: null,
        isDropRound,
        team1Score: 0,
        team2Score: 0,
        loserTo: null,
        seriesId: null
      };

      const nextRound = round + 1;
      if (nextRound > lbRounds) {
        match.winnerTo = 'gf-m1';
        match.winnerToSlot = 2;
      } else {
        const isNextRoundDrop = nextRound >= firstDropRound
          && (nextRound - firstDropRound) % 2 === 0;

        if (isNextRoundDrop) {
          match.winnerTo = `lb-r${nextRound}-m${matchNum}`;
          match.winnerToSlot = 1;
        } else {
          match.winnerTo = `lb-r${nextRound}-m${Math.ceil(matchNum / 2)}`;
          match.winnerToSlot = matchNum % 2 === 1 ? 1 : 2;
        }
      }

      if (isDropRound) {
        match.dropSourceRound = ((round - firstDropRound) / 2) + 1;
      }

      matches.push(match);
    }

    structure.lowerBracket.push({ round, matches });
  }

  structure.grandFinals.push({
    id: 'gf-m1',
    bracket: 'grand',
    round: 1,
    team1Id: null,
    team2Id: null,
    team1Score: 0,
    team2Score: 0,
    seriesId: null
  });

  return structure;
};

export const normalizeEqualSizePlayoffBracket = (bracket) => {
  const upperFirstRound = bracket?.upperBracket?.find((round) => round.round === 1);
  const lowerFirstRound = bracket?.lowerBracket?.find((round) => round.round === 1);
  const lowerSecondRound = bracket?.lowerBracket?.find((round) => round.round === 2);

  const isEqualSize = upperFirstRound?.matches?.length > 0
    && upperFirstRound.matches.length === lowerFirstRound?.matches?.length;
  const usesLegacyRouting = upperFirstRound?.matches?.every((match) => (
    /^lb-r3-m\d+$/.test(match.loserTo || '')
  ));

  if (!isEqualSize || !usesLegacyRouting || !lowerSecondRound) {
    return { bracket, changed: false };
  }

  const laterLowerMatches = bracket.lowerBracket
    .filter((round) => round.round >= 2)
    .flatMap((round) => round.matches);

  if (laterLowerMatches.some(hasResult)) {
    return {
      bracket,
      changed: false,
      error: 'The saved bracket uses the old equal-size format, but lower-bracket round 2 or later already has a result.'
    };
  }

  const normalized = JSON.parse(JSON.stringify(bracket));
  normalized.upperBracket.forEach((round) => {
    round.matches.forEach((match) => {
      match.loserTo = `lb-r${round.round * 2}-m${match.matchNum}`;
    });
  });

  normalized.lowerBracket = normalized.lowerBracket
    .filter((round) => round.round !== 2)
    .map((round) => {
      if (round.round === 1) {
        round.matches.forEach((match) => {
          match.winnerTo = `lb-r2-m${match.matchNum}`;
          match.winnerToSlot = 1;
        });
        return round;
      }

      round.round -= 1;
      round.matches.forEach((match) => {
        match.round -= 1;
        match.id = `lb-r${match.round}-m${match.matchNum}`;
        match.winnerTo = rewriteLowerTarget(match.winnerTo, -1);
        match.isDropRound = match.round % 2 === 0;

        if (match.isDropRound) {
          match.dropSourceRound = match.round / 2;
        } else {
          delete match.dropSourceRound;
        }
      });
      return round;
    });

  const firstDropRound = normalized.lowerBracket.find((round) => round.round === 2);
  firstDropRound.matches.forEach((match, index) => {
    const winner = getWinner(normalized.lowerBracket[0].matches[index]);
    match.team1Id = winner?.id ?? null;
    match.team1Name = winner?.name ?? null;
  });

  return { bracket: normalized, changed: true };
};
