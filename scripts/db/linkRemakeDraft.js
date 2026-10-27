import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {configureWarehouseConnection} from '../../config/warehouseConnection.js';
import {ensureRemakeDraftSchema,normalizeRemakeDraft,planRemakeDraftLink,linkRemakeDraft} from '../../config/remakeDrafts.js';

const usage='Usage: node scripts/db/linkRemakeDraft.js <existing-LadsData.db> --draft-match-id N --match-id N [--apply] [--draft-json file] [--match-json file]';
let db;
try {
  const args=process.argv.slice(2),target=args.shift(),options={};
  if(!target||target.startsWith('--'))throw Error(usage);
  while(args.length){
    const key=args.shift();
    if(key==='--apply'){options.apply=true;continue;}
    if(!['--draft-match-id','--match-id','--draft-json','--match-json'].includes(key)||!args.length||args[0].startsWith('--'))throw Error(usage);
    if(options[key]!==undefined)throw Error(`Repeated option: ${key}`);
    options[key]=args.shift();
  }
  const id=key=>{
    const value=options[key];
    if(!/^\d+$/.test(value||'')||!Number.isSafeInteger(Number(value))||Number(value)<=0)throw Error(usage);
    return Number(value);
  };
  const sourceId=id('--draft-match-id'),matchId=id('--match-id');
  if(sourceId===matchId)throw Error('Source and played match must differ');
  db=new Database(resolve(target),{fileMustExist:true,readonly:!options.apply});
  configureWarehouseConnection(db,{role:options.apply?'migration':'readonly'});
  const load=async(matchId,file)=>{
    let data;
    if(file)data=JSON.parse(readFileSync(resolve(file),'utf8'));
    else{
      const response=await fetch(`https://api.opendota.com/api/matches/${matchId}`,{signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(`OpenDota ${matchId}: HTTP ${response.status}`);
      data=await response.json();
    }
    if(data?.match_id!==matchId)throw Error('Response match ID does not match the requested match');
    return data;
  };
  const sourceData=await load(sourceId,options['--draft-json']);
  const matchData=await load(matchId,options['--match-json']);
  const source=normalizeRemakeDraft(sourceData);
  let plan=planRemakeDraftLink(db,source,matchId,matchData);
  if(options.apply){ensureRemakeDraftSchema(db);plan=linkRemakeDraft(db,source,matchId,matchData);}
  const {rows,...summary}=plan;
  console.log(JSON.stringify({mode:options.apply?'apply':'preview',...summary},null,2));
  if(!options.apply)console.log('Preview only. Add --apply to store the draft source and attach its picks/bans.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{db?.close();}
