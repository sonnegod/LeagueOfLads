import {readFileSync} from 'node:fs';
import Database from 'better-sqlite3';
import {ensureMatchResultsSchema} from '../../config/matchResultsSchema.js';
import {readPlayoffBracket,savePlayoffBracket} from '../../config/playoffBracketAdmin.js';
import {generatePlayoffBracket,suggestPlayoffSeeding} from '../../shared/playoffBracket.js';

export function playoffFixture(poolSize=4) {
  const db=new Database(':memory:');db.exec(readFileSync(new URL('../../scripts/db/ladsData.schema.sql',import.meta.url),'utf8'));ensureMatchResultsSchema(db);
  db.exec("INSERT INTO LeagueInfo VALUES(100,'Active',1);INSERT INTO GroupNames(LeagueId,GroupId,GroupName) VALUES(100,1,'Moon'),(100,2,'Sun')");
  for(let i=1;i<=poolSize*2;i++) {
    db.prepare('INSERT INTO TeamInfo VALUES(?,?)').run(i,`Team ${i}`);
    db.prepare('INSERT INTO PlayoffSeeding(LeagueId,TeamId,Seed,Bracket) VALUES(100,?,?,?)').run(i,(i-1)%poolSize+1,i<=poolSize?'upper':'lower');
    db.prepare('INSERT INTO LeagueGroups(LeagueId,TeamId,GroupId) VALUES(100,?,?)').run(i,i%2+1);
  }
  const initial=readPlayoffBracket(db,100),bracket=suggestPlayoffSeeding(generatePlayoffBracket(initial.result),initial.result);
  bracket.grandFinals[0].bestOf=5;
  const save=(value,revision=readPlayoffBracket(db,100).revision)=>savePlayoffBracket(db,100,{bracketData:value,revision});
  return {db,bracket,save,close:()=>db.close()};
}

