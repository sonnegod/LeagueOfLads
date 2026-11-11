export const playoffMatches=bracket=>[
  ...(bracket?.upperBracket||[]).flatMap(round=>round.matches||[]),
  ...(bracket?.lowerBracket||[]).flatMap(round=>round.matches||[]),
  ...(bracket?.grandFinals||[]),
];
export const playoffFormat=(match,finalDefault=null)=>Number(match?.bestOf)||(match?.bracket==='grand'?Number(finalDefault)||null:3);
export function playoffResult(match,bestOf=playoffFormat(match)) {
  const score=value=>value==null||value===''?0:Number(value);
  const a=score(match?.team1Score),b=score(match?.team2Score),target=bestOf?(bestOf+1)/2:null;
  const valid=Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0
    &&(!target||a<=target&&b<=target&&a+b<=bestOf&&!(a===target&&b===target));
  const complete=valid&&Boolean(match?.team1Id&&match?.team2Id&&Number(match.team1Id)!==Number(match.team2Id))
    &&Boolean(target)&&(a===target||b===target)&&!['in_progress','needs_review','needs_format'].includes(match.seriesStatus);
  return {valid,complete,a,b,target,winnerSlot:complete?(a>b?1:2):null,loserSlot:complete?(a>b?2:1):null};
}
export const playoffHasResult=match=>Boolean(match?.seriesId)||Number(match?.team1Score||0)!==0||Number(match?.team2Score||0)!==0;
export function playoffLabels(bracket) {
  const labels=new Map();
  for(const [key,prefix]of [['upperBracket','UB'],['lowerBracket','LB']]) {
    let index=0;for(const round of bracket?.[key]||[])for(const match of round.matches)labels.set(match.id,`${prefix}${++index}`);
  }
  (bracket?.grandFinals||[]).forEach((match,index)=>labels.set(match.id,(bracket.grandFinals.length>1?`GF${index+1}`:'GF')));
  return labels;
}
export function playoffSources(bracket) {
  const sources=new Map();
  for(const match of playoffMatches(bracket))for(const [target,slot,kind]of [
    [match.winnerTo,match.winnerToSlot||1,'winner'],[match.loserTo,match.loserToSlot||2,'loser'],
  ])if(target)sources.set(`${target}:${slot}`,{matchId:match.id,kind});
  return sources;
}
export function playoffSlotLabel(bracket,matchId,slot) {
  const source=playoffSources(bracket).get(`${matchId}:${slot}`);
  if(!source)return 'Select team';
  return `${source.kind==='winner'?'Winner':'Loser'} of ${playoffLabels(bracket).get(source.matchId)||source.matchId}`;
}

// Resolve a bracket in dependency order. A changed feeder cannot silently
// replace a participant in a downstream match that already has a result.
export function resolvePlayoffProgression(input) {
  const bracket=structuredClone(input),matches=playoffMatches(bracket),byId=new Map(matches.map(match=>[match.id,match]));
  const sources=playoffSources(bracket),done=new Set(),visiting=new Set(),errors=[];
  function visit(match) {
    if(done.has(match.id))return;
    if(visiting.has(match.id)){errors.push('The bracket contains a circular match path.');return;}
    visiting.add(match.id);
    for(const slot of [1,2]) {
      const source=sources.get(`${match.id}:${slot}`);if(!source)continue;
      const feeder=byId.get(source.matchId);if(!feeder){errors.push('A bracket match path is missing.');continue;}
      visit(feeder);const result=playoffResult(feeder),from=source.kind==='winner'?result.winnerSlot:result.loserSlot;
      const expected=from?Number(feeder[`team${from}Id`])||null:null;
      if((Number(match[`team${slot}Id`])||null)!==expected&&playoffHasResult(match)) {
        errors.push(`${playoffLabels(bracket).get(match.id)} already has a result; correct its recorded series before changing an earlier result.`);continue;
      }
      match[`team${slot}Id`]=expected;
      match[`team${slot}Name`]=from?feeder[`team${from}Name`]||null:null;
      match[`team${slot}Seed`]=from?feeder[`team${from}Seed`]||null:null;
    }
    visiting.delete(match.id);done.add(match.id);
  }
  for(const match of matches)visit(match);
  return {bracket,errors:[...new Set(errors)]};
}

export function suggestPlayoffSeeding(input,teams) {
  const bracket=structuredClone(input);
  for(const [key,pool]of [['upperBracket','upper'],['lowerBracket','lower']]) {
    const ranked=teams.filter(team=>team.Bracket===pool).sort((a,b)=>Number(a.Seed)-Number(b.Seed)||Number(a.TeamId)-Number(b.TeamId));
    let order=[1,2];while(order.length<ranked.length)order=order.flatMap(seed=>[seed,order.length*2+1-seed]);
    (bracket[key]?.[0]?.matches||[]).forEach((match,index)=>{for(const slot of [1,2]) {
      const team=ranked[order[index*2+slot-1]-1];match[`team${slot}Id`]=team?.TeamId||null;match[`team${slot}Name`]=team?.TeamName||null;match[`team${slot}Seed`]=team?.Seed||null;
    }});
  }
  return bracket;
}

export const generatePlayoffBracket = (teams) => {
  const ubTeams = teams.filter((team) => team.Bracket === 'upper');
  const lbTeams = teams.filter((team) => team.Bracket === 'lower');
  const ubCount = ubTeams.length;
  const lbStartCount = lbTeams.length;
  if(ubCount<2||!Number.isInteger(Math.log2(ubCount))||![ubCount,ubCount*2].includes(lbStartCount))
    throw new Error('Bracket setup needs a power-of-two upper pool and a lower pool of the same size or twice that size.');
  const ubRounds = Math.log2(ubCount);
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

