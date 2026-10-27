import {randomUUID} from 'node:crypto';

const compareIds=(a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0;
const candidate=message=>(message.mentions?.roles?.size||0)>=2
  ||/^\s*\d{1,10}\s+(?:vs\.?|v\.?|against)\s+\d{1,10}\b/i.test(message.content)
  ||[...String(message.content||'').matchAll(/\b\d{6,10}\b/g)].length>=2||/\b(reschedul|cancel|forfeit)/i.test(message.content);

// The channel adapter only needs messages.fetch. Local tests exercise the same
// pagination/reconciliation path as Discord without credentials or network calls.
export async function pollSchedules({store,channel,channelId,season,now=()=>new Date(),maxPages=20,pageSize=100,reconcileLimit=50}) {
  if(!Number.isFinite(Date.parse(season.CreatedAt)))throw Object.assign(new Error('Season creation time is unavailable'),{code:'DISCORD_SEASON_TIME_UNAVAILABLE'});
  const db=store.db,owner=randomUUID(),leaseMs=10*60000;let changed=0;
  const lease=()=>new Date(now().getTime()+leaseMs).toISOString();
  const acquired=db.prepare(`INSERT INTO DiscordSchedulePollLocks VALUES(?,?,?) ON CONFLICT(ChannelId) DO UPDATE SET
    Owner=excluded.Owner,LeaseUntilUtc=excluded.LeaseUntilUtc WHERE DiscordSchedulePollLocks.LeaseUntilUtc<=?`)
    .run(channelId,owner,lease(),now().toISOString());
  if(!acquired.changes)return {skipped:'poll_in_progress',processed:0,changed:0};
  const heartbeat=()=>{if(!db.prepare('UPDATE DiscordSchedulePollLocks SET LeaseUntilUtc=? WHERE ChannelId=? AND Owner=?').run(lease(),channelId,owner).changes)
    throw Object.assign(new Error('Scheduling poll lease was lost'),{code:'DISCORD_POLL_LEASE_LOST'});};
  const tracked=db.prepare('SELECT EventId FROM ScheduleMessages WHERE MessageId=?');
  function ingest(message) {
    const previous=tracked.get(String(message.id));
    const referenced=message.reference?.messageId&&tracked.get(String(message.reference.messageId));
    if(message.author?.bot||(!previous&&!referenced&&!candidate(message))||!Number.isFinite(message.createdAt?.getTime())
      ||message.createdAt.getTime()<Date.parse(season.CreatedAt))return;
    const result=store.ingest({channelId,messageId:message.id,content:message.content,
      roleNames:Object.fromEntries([...(message.mentions?.roles||[])].map(([id,role])=>[id,role.name])),
      authoredAt:message.createdAt.toISOString(),editedAt:message.editedAt?.toISOString(),replyTo:message.reference?.messageId},season.SeasonId,now());
    db.prepare('UPDATE ScheduleMessages SET LastSeenAtUtc=? WHERE MessageId=?').run(now().toISOString(),message.id);
    if(!result.unchanged)changed++;
  }
  try {
    const saved=db.prepare('SELECT * FROM DiscordScheduleCursors WHERE ChannelId=?').get(channelId),cursor=saved?.LastMessageId;
    const seen=new Map();let before=saved?.BackfillBefore,reached=false,newest=saved?.NewestBoundary||null;
    for(let page=0;page<maxPages;page++) {
      const messages=await channel.messages.fetch({limit:pageSize,...(before?{before}:{})});heartbeat();
      if(!messages.size){reached=true;break;}
      const sorted=[...messages.values()].sort(compareIds);newest||=sorted.at(-1).id;
      for(const message of sorted) {
        seen.set(message.id,message);if(cursor&&BigInt(message.id)<=BigInt(cursor))reached=true;
      }
      if(reached||messages.size<pageSize){reached=true;break;}before=sorted[0].id;
    }
    // Tracked posts below the cursor still need edit reconciliation. A post
    // edited down to plain text must enter review instead of silently retaining
    // its former fixture/odds. Process originals before their referenced replies.
    for(const message of [...seen.values()].sort(compareIds))if(!cursor||BigInt(message.id)>BigInt(cursor)||tracked.get(message.id))ingest(message);
    if(newest)db.prepare(`INSERT INTO DiscordScheduleCursors(ChannelId,LastMessageId,UpdatedAtUtc,BackfillBefore,NewestBoundary) VALUES(?,?,?,?,?)
      ON CONFLICT(ChannelId) DO UPDATE SET LastMessageId=excluded.LastMessageId,UpdatedAtUtc=excluded.UpdatedAtUtc,
      BackfillBefore=excluded.BackfillBefore,NewestBoundary=excluded.NewestBoundary`)
      .run(channelId,reached?newest:cursor||null,now().toISOString(),reached?null:before,reached?null:newest);
    const rows=db.prepare(`SELECT m.MessageId,m.AuthoredAtUtc FROM ScheduleMessages m LEFT JOIN ScheduledEvents e ON e.EventId=m.EventId
      WHERE m.ChannelId=? AND m.SeasonId=? AND m.Deleted=0 AND m.DismissedAtUtc IS NULL
        AND (e.Status IN ('scheduled','started','needs_review') OR m.ParseStatus='needs_review')
      ORDER BY m.LastSeenAtUtc,m.MessageId LIMIT ?`).all(channelId,season.SeasonId,reconcileLimit);
    for(const row of rows) {
      if(seen.has(row.MessageId))continue;
      try {const message=await channel.messages.fetch(row.MessageId);heartbeat();ingest(message);}
      catch(error) {
        if(error.code!==10008)throw error;heartbeat(); // Only Discord's unknown-message response means deleted.
        const result=store.ingest({channelId,messageId:row.MessageId,authoredAt:row.AuthoredAtUtc,content:'',deleted:true},season.SeasonId,now());
        db.prepare('UPDATE ScheduleMessages SET LastSeenAtUtc=? WHERE MessageId=?').run(now().toISOString(),row.MessageId);
        if(!result.unchanged)changed++;
      }
    }
    return {processed:seen.size,changed,catchupComplete:reached};
  }finally{db.prepare('DELETE FROM DiscordSchedulePollLocks WHERE ChannelId=? AND Owner=?').run(channelId,owner);}
}
