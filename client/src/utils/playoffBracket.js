import {playoffResult,generatePlayoffBracket} from '../../../shared/playoffBracket.js';
export {generatePlayoffBracket} from '../../../shared/playoffBracket.js';

const getWinner = (match) => {
  if (!match?.team1Id || !match?.team2Id) return null;

  const team1Score = Number(match.team1Score || 0);
  const team2Score = Number(match.team2Score || 0);
  if (!playoffResult(match).complete) return null;

  return team1Score > team2Score
    ? { id: match.team1Id, name: match.team1Name }
    : { id: match.team2Id, name: match.team2Name };
};

const getLoser = (match) => {
  if (!match?.team1Id || !match?.team2Id) return null;

  const team1Score = Number(match.team1Score || 0);
  const team2Score = Number(match.team2Score || 0);
  if (!playoffResult(match).complete) return null;

  return team1Score < team2Score
    ? { id: match.team1Id, name: match.team1Name }
    : { id: match.team2Id, name: match.team2Name };
};

const hasResult = (match) => {
  const team1Score = Number(match.team1Score || 0);
  const team2Score = Number(match.team2Score || 0);
  return Boolean(match.seriesId) || team1Score !== 0 || team2Score !== 0;
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
  const startingTeamCount = upperFirstRound.matches.length * 2;
  const templateTeams = [
    ...Array.from({ length: startingTeamCount }, () => ({ Bracket: 'upper' })),
    ...Array.from({ length: startingTeamCount }, () => ({ Bracket: 'lower' }))
  ];
  const correctedTemplate = generatePlayoffBracket(templateTeams);

  normalized.upperBracket.forEach((round) => {
    round.matches.forEach((match) => {
      match.loserTo = `lb-r${round.round * 2}-m${match.matchNum}`;
    });
  });

  const correctedFirstRound = correctedTemplate.lowerBracket[0];
  normalized.lowerBracket = correctedTemplate.lowerBracket.map((round) => {
    if (round.round !== 1) return round;

    return {
      ...round,
      matches: lowerFirstRound.matches.map((match, index) => ({
        ...match,
        winnerTo: correctedFirstRound.matches[index].winnerTo,
        winnerToSlot: correctedFirstRound.matches[index].winnerToSlot,
        isDropRound: false
      }))
    };
  });

  const correctedLowerMatches = normalized.lowerBracket.flatMap((round) => round.matches);
  const placeTeam = (matchId, slot, team) => {
    if (!team) return;
    const target = correctedLowerMatches.find((match) => match.id === matchId);
    if (!target) return;
    target[`team${slot}Id`] = team.id;
    target[`team${slot}Name`] = team.name;
  };

  normalized.lowerBracket[0].matches.forEach((match) => {
    placeTeam(match.winnerTo, match.winnerToSlot, getWinner(match));
  });

  normalized.upperBracket.forEach((round) => {
    round.matches.forEach((match) => {
      placeTeam(match.loserTo, 2, getLoser(match));
    });
  });

  return { bracket: normalized, changed: true };
};
