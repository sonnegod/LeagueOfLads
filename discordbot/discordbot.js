import 'dotenv/config';
import Database from 'better-sqlite3';
import {Client,GatewayIntentBits} from 'discord.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyticsPaths} from '../analytics/config.js';
import {ScheduleStore} from '../betting/scheduleStore.js';
import {markBettingDirty} from '../betting/refreshQueue.js';
import {pollSchedules} from './schedulePoller.js';

// This polling worker reads scheduling posts and never sends messages.
const channelId=process.env.DISCORD_SCHEDULE_CHANNEL_ID||'626493827544514580';
let db,client;
try {
  db=new Database(analyticsPaths().league,{fileMustExist:true});db.pragma('busy_timeout=5000');
  const store=new ScheduleStore(db,{changed:()=>markBettingDirty(db)});
  const season=db.prepare("SELECT SeasonId,CreatedAt FROM LeagueSeasons WHERE Status IN ('signup_closed','active') ORDER BY SeasonId DESC LIMIT 1").get();
  if(season) {
    if(!process.env.DISCORD_TOKEN)throw Object.assign(new Error('Discord token is missing'),{code:'DISCORD_TOKEN_MISSING'});
    client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
    await client.login(process.env.DISCORD_TOKEN);
    const channel=await client.channels.fetch(channelId);if(!channel?.messages)throw Object.assign(new Error('Scheduling channel is unavailable'),{code:'DISCORD_CHANNEL_UNAVAILABLE'});
    console.log(JSON.stringify(await pollSchedules({store,channel,channelId,season})));
  }else console.log('No season is accepting schedules.');
}catch(error){console.error('Scheduling load failed:',error.code||'discord_poll_failed');process.exitCode=1;}
finally{client?.destroy();}

// A partial import or failed previous refresh must not depend on seeing another
// new Discord post. Persisted dirty revisions also resume after an API restart.
try {
  const state=db?.prepare('SELECT RequestedRevision,CompletedRevision FROM BettingRefreshState WHERE Id=1').get();
  db?.close();db=null;
  if(state?.RequestedRevision>state?.CompletedRevision) {
    const code=await new Promise(resolve=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/betting/run.js',import.meta.url)),'--refresh-analytics'],
      {windowsHide:true,stdio:'inherit'});child.once('error',()=>resolve(1));child.once('close',resolve);});
    if(code!==0)process.exitCode=1;
  }
}catch{db?.close();console.error('Scheduling refresh failed');process.exitCode=1;}
