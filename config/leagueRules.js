export const DEFAULT_LEAGUE_RULES = Object.freeze({
  UpperBracketTeams: 2,
  LowerBracketTeams: 5,
  EliminatedTeams: 2,
  HasTiebreaker: true,
  TiebreakerPosition: 3,
});

const invalid = message => { throw Object.assign(new Error(message), {status:400}); };
const destinations = new Set(['upper','lower','eliminated']);
export function normalizeQualificationPlan(value, groupSizes=null) {
  let input=value;
  if(typeof input==='string')try{input=JSON.parse(input);}catch{invalid('Invalid qualification rules');}
  if(!input||input.version!==1||!Array.isArray(input.groups)||!input.groups.length||input.groups.length>50
    ||!Array.isArray(input.tiebreakers)||input.tiebreakers.length>20)invalid('Provide group rows and tiebreaker pools');
  const ids=new Set(),names=new Set();
  const tiebreakers=input.tiebreakers.map(pool=>{
    if(typeof pool?.id!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(pool.id)||ids.has(pool.id)
      ||typeof pool.name!=='string'||!pool.name.trim()||pool.name.trim().length>60||names.has(pool.name.trim().toLowerCase())
      ||![1,3].includes(Number(pool.bestOf)))invalid('Give each tiebreaker a unique name and BO1 or BO3 format');
    ids.add(pool.id);names.add(pool.name.trim().toLowerCase());
    const result={id:pool.id,name:pool.name.trim(),bestOf:Number(pool.bestOf)};
    for(const key of destinations) {
      if(pool[key]==null||pool[key]===''||!Number.isSafeInteger(Number(pool[key]))||Number(pool[key])<0||Number(pool[key])>500)
        invalid('Tiebreaker advancement counts must be non-negative whole numbers');
      result[key]=Number(pool[key]);
    }
    return result;
  });
  const groups=input.groups.map((group,index)=>{
    if(!group||group.group!==index+1||!Array.isArray(group.rows)||!group.rows.length||group.rows.length>100)
      invalid('Assign every standings row in group order');
    for(const row of group.rows)if(!destinations.has(row)&&!(typeof row==='string'&&row.startsWith('tie:')&&ids.has(row.slice(4))))
      invalid('Choose a destination for every standings row');
    return {group:index+1,rows:[...group.rows]};
  });
  if(groupSizes&&(groupSizes.length!==groups.length||groups.some((group,index)=>group.rows.length!==groupSizes[index])))
    invalid('Group rules no longer match the group sizes. Reload the groups and edit their rules.');
  for(const pool of tiebreakers) {
    const count=groups.reduce((sum,group)=>sum+group.rows.filter(row=>row===`tie:${pool.id}`).length,0);
    if(count<2)invalid(`${pool.name} needs at least two selected teams`);
    if(pool.upper+pool.lower+pool.eliminated!==count)
      invalid(`${pool.name}: upper, lower and eliminated counts must total ${count} teams`);
  }
  return {version:1,groups,tiebreakers};
}

export function normalizeLeagueRules(row = {}) {
  const source=row.QualificationPlan??row.QualificationJson;
  if(source) {
    const QualificationPlan=normalizeQualificationPlan(source);
    const first=QualificationPlan.groups[0].rows;
    return {UpperBracketTeams:first.filter(r=>r==='upper').length,LowerBracketTeams:first.filter(r=>r==='lower').length,
      EliminatedTeams:first.filter(r=>r==='eliminated').length,HasTiebreaker:QualificationPlan.tiebreakers.length>0,
      TiebreakerPosition:first.some(r=>r.startsWith('tie:'))?first.findIndex(r=>r.startsWith('tie:'))+1:null,QualificationPlan};
  }
  const hasTiebreaker = Boolean(Number(row.HasTiebreaker));
  return {
    UpperBracketTeams: Math.max(0, Number(row.UpperBracketTeams) || 0),
    LowerBracketTeams: Math.max(0, Number(row.LowerBracketTeams) || 0),
    EliminatedTeams: Math.max(0, Number(row.EliminatedTeams) || 0),
    HasTiebreaker: hasTiebreaker,
    TiebreakerPosition: hasTiebreaker ? Math.max(1, Number(row.TiebreakerPosition) || 1) : null,
  };
}

export function classifyStandings(teams, rawRules, groupNumber=1) {
  const rules = normalizeLeagueRules(rawRules);
  if(rules.QualificationPlan) {
    const rows=rules.QualificationPlan.groups.find(group=>group.group===groupNumber)?.rows;
    if(!rows||rows.length!==teams.length)return teams.map((team,index)=>({...team,Rank:index+1,Qualification:null}));
    return teams.map((team,index)=>{
      const destination=rows[index],pool=destination.startsWith('tie:')
        ?rules.QualificationPlan.tiebreakers.find(p=>p.id===destination.slice(4)):null;
      return {...team,Rank:index+1,Qualification:pool?'tiebreaker':destination,
        ...(pool?{TiebreakerId:pool.id,TiebreakerName:pool.name}:{})};
    });
  }
  let lowerAssigned = 0;

  return teams.map((team, index) => {
    const rank = index + 1;
    let Qualification = 'eliminated';
    if (rank <= rules.UpperBracketTeams) Qualification = 'upper';
    else if (rules.HasTiebreaker && rank === rules.TiebreakerPosition) Qualification = 'tiebreaker';
    else if (lowerAssigned < rules.LowerBracketTeams) {
      Qualification = 'lower';
      lowerAssigned += 1;
    }
    return { ...team, Rank: rank, Qualification };
  });
}

export function qualificationPools(teams,rawRules) {
  return (normalizeLeagueRules(rawRules).QualificationPlan?.tiebreakers||[]).map(pool=>({...pool,
    teams:teams.filter(team=>team.TiebreakerId===pool.id)}));
}
