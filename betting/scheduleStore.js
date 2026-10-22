import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseScheduleMessage, PARSER_VERSION } from './scheduleParser.js';
import { currentSeasonRoster, conflictingRosterPlayers } from './rosterMembership.js';
import { ensurePendingRosterSchema, currentPendingSlots } from '../config/pendingRosterSlots.js';
import {ensureRosterDisplayOrderSchema,validRosterOrder} from '../config/rosterDisplayOrder.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function fail(message, status = 400, code = 'INVALID_REQUEST') { const error = new Error(message); error.status = status; error.code = code; throw error; }
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const utc = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const matchDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});

export class ScheduleStore {
  constructor(db, { audit = () => {}, changed = () => {} } = {}) {
    this.db = db; this.audit = audit; this.changed = changed;
    ensurePendingRosterSchema(db);
    ensureRosterDisplayOrderSchema(db);
    db.exec(readFileSync(new URL('../scripts/db/schedules.schema.sql', import.meta.url), 'utf8'));
    const refreshColumns=db.pragma('table_info(BettingRefreshState)').map(c=>c.name);
    for(const [name,type] of Object.entries({LastAttemptAtUtc:'TEXT',LastCompletedAtUtc:'TEXT',ConsecutiveFailures:'INTEGER NOT NULL DEFAULT 0',LastErrorCode:'TEXT',NextRetryAtUtc:'TEXT'}))
      if(!refreshColumns.includes(name))db.exec(`ALTER TABLE BettingRefreshState ADD COLUMN ${name} ${type}`);
    const cursorColumns=db.pragma('table_info(DiscordScheduleCursors)').map(c=>c.name);
    for(const name of ['BackfillBefore','NewestBoundary'])if(!cursorColumns.includes(name))db.exec(`ALTER TABLE DiscordScheduleCursors ADD COLUMN ${name} TEXT`);
    if(!db.pragma('table_info(ScheduleMessages)').some(c=>c.name==='SeasonId'))db.exec('ALTER TABLE ScheduleMessages ADD COLUMN SeasonId INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ScheduleMessages_Review ON ScheduleMessages(SeasonId,ParseStatus,LastSeenAtUtc)');
    db.prepare('UPDATE ScheduleMessages SET SeasonId=(SELECT SeasonId FROM ScheduledEvents e WHERE e.EventId=ScheduleMessages.EventId) WHERE SeasonId IS NULL AND EventId IS NOT NULL').run();
    this.syncRosterHistory();
  }
  syncRosterHistory() {
    const db=this.db;
    if(['TeamRosterPeriods','TeamRosterPlayers'].every(name=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))) {
      db.prepare(`INSERT OR IGNORE INTO TeamRosterMembershipHistory (TeamSubmissionId,PlayerId,Slot,EffectiveFromUtc,EffectiveToUtc,FromEstimated)
        SELECT r.TeamSubmissionId,r.PlayerId,r.Slot,p.EffectiveFrom,p.EffectiveTo,p.FromEstimated FROM TeamRosterPlayers r
        JOIN TeamRosterPeriods p ON p.TeamSubmissionId=r.TeamSubmissionId WHERE p.EffectiveFrom IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM TeamRosterMembershipHistory h WHERE h.TeamSubmissionId=r.TeamSubmissionId AND h.PlayerId=r.PlayerId)`).run();
    }
  }
  teams(seasonId) {
    const pending=currentPendingSlots(this.db,seasonId);
    const rows=this.db.prepare('SELECT TeamSubmissionId, TeamName, ExternalTeamId, GroupId, IsManual FROM SeasonTeams WHERE SeasonId = ? ORDER BY TeamSubmissionId').all(seasonId)
      .map(t=>({...t,PendingPlayers:pending.filter(p=>p.TeamSubmissionId===t.TeamSubmissionId).length}));
    const season=this.db.prepare('SELECT Status,ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
    if(['active','ended'].includes(season?.Status)&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='LeagueRosterEntries'").get()) {
      return rows.map(t=>({...t,GroupId:this.db.prepare('SELECT GroupId FROM LeagueRosterEntries WHERE LeagueId=? AND (TeamSubmissionId=? OR TeamId=?) ORDER BY EntryId LIMIT 1')
        .get(season.ExternalLeagueId,t.TeamSubmissionId,t.ExternalTeamId)?.GroupId||null}));
    }
    return rows;
  }
  get(eventId) { return this.db.prepare('SELECT * FROM ScheduledEvents WHERE EventId = ?').get(eventId); }
  list(seasonId,{includeLocalTests=false}={}) { return this.db.prepare(`SELECT e.*, a.TeamName AS Team1Name, b.TeamName AS Team2Name FROM ScheduledEvents e
    JOIN SeasonTeams a ON a.TeamSubmissionId = e.Team1Key JOIN SeasonTeams b ON b.TeamSubmissionId = e.Team2Key
    WHERE e.SeasonId = ? AND (?=1 OR e.SourceMessageId IS NULL OR e.SourceMessageId NOT LIKE 'local-test:%')
    ORDER BY e.ScheduledStartUtc, e.EventId LIMIT 200`).all(seasonId,Number(includeLocalTests)); }
  revision(eventId, actor, reason) {
    const event = this.get(eventId);
    this.db.prepare('INSERT INTO ScheduleEventRevisions VALUES (?, ?, ?, ?, ?, ?)')
      .run(eventId, event.Revision, JSON.stringify(event), actor == null ? null : String(actor), reason, event.UpdatedAtUtc);
  }
  linkPlayedSeries(seasonId,now=new Date()) {
    // Older/minimal source schemas cannot provide a trustworthy played date.
    if(!this.db.pragma('table_info(SeriesInfo)').some(c=>c.name==='DateCreated'))return {linked:0,needsReview:0};
    return this.db.transaction(()=>{
      const fixtures=this.db.prepare(`SELECT e.*,s.ExternalLeagueId,a.ExternalTeamId AS Team1Id,b.ExternalTeamId AS Team2Id
        FROM ScheduledEvents e JOIN LeagueSeasons s USING(SeasonId)
        JOIN SeasonTeams a ON a.TeamSubmissionId=e.Team1Key AND a.SeasonId=e.SeasonId
        JOIN SeasonTeams b ON b.TeamSubmissionId=e.Team2Key AND b.SeasonId=e.SeasonId
        WHERE e.SeasonId=? AND e.Status IN ('scheduled','started','completed','needs_review')
          AND (e.SourceMessageId IS NULL OR e.SourceMessageId NOT LIKE 'local-test:%')`).all(seasonId);
      const dated=fixtures.filter(e=>e.ExternalLeagueId&&e.Team1Id&&e.Team2Id&&e.Team1Id!==e.Team2Id
        &&Number.isFinite(Date.parse(e.ScheduledStartUtc))).map(e=>({...e,day:matchDay.format(new Date(e.ScheduledStartUtc))}));
      const key=e=>JSON.stringify([e.ExternalLeagueId,e.Stage,e.day,...[e.Team1Id,e.Team2Id].sort((a,b)=>a-b)]);
      const counts=new Map();
      for(const event of dated)counts.set(key(event),(counts.get(key(event))||0)+1);
      const candidates=this.db.prepare(`SELECT SeriesId FROM SeriesInfo s WHERE LeagueId=? AND Stage=? AND DateCreated=?
        AND ((Team1=? AND Team2=?) OR (Team1=? AND Team2=?))
        AND EXISTS(SELECT 1 FROM SeriesMatch m WHERE m.SeriesId=s.SeriesId) ORDER BY SeriesId LIMIT 2`);
      const claimed=this.db.prepare('SELECT 1 FROM ScheduledEvents WHERE SeriesId=? LIMIT 1');
      let linked=0,needsReview=0;
      for(const event of dated) {
        if(event.SeriesId||event.Status==='needs_review'||Date.parse(event.ScheduledStartUtc)>now.getTime())continue;
        const stage={regular:'g',playoff:'p'}[event.Stage];if(!stage)continue;
        const matches=candidates.all(event.ExternalLeagueId,stage,event.day,event.Team1Id,event.Team2Id,event.Team2Id,event.Team1Id);
        if(!matches.length)continue;
        if(matches.length>1||counts.get(key(event))>1) {
          this.db.prepare("UPDATE ScheduledEvents SET Status='needs_review',Revision=Revision+1,UpdatedAtUtc=? WHERE EventId=?")
            .run(now.toISOString(),event.EventId);
          this.revision(event.EventId,null,'Automatic series linking needs review: multiple matching fixtures or played series');
          needsReview++;continue;
        }
        if(claimed.get(matches[0].SeriesId))continue;
        this.db.prepare('UPDATE ScheduledEvents SET SeriesId=?,Revision=Revision+1,UpdatedAtUtc=? WHERE EventId=?')
          .run(matches[0].SeriesId,now.toISOString(),event.EventId);
        this.revision(event.EventId,null,'Played series linked automatically by league, teams, stage and New York match date');
        linked++;
      }
      return {linked,needsReview};
    }).immediate();
  }
  recordVerifiedCompletion(eventId,startedAt,now=new Date()) {
    return this.db.transaction(()=>{
      const changed=this.db.prepare(`UPDATE ScheduledEvents SET Status='completed',StartedAtUtc=COALESCE(StartedAtUtc,?),
        Revision=Revision+1,UpdatedAtUtc=? WHERE EventId=? AND Status IN ('scheduled','started')`)
        .run(startedAt,now.toISOString(),eventId);
      if(changed.changes)this.revision(eventId,null,'Played series completed with verified results');
      return this.get(eventId);
    })();
  }
  save(seasonId, input, actor = null, now = new Date()) {
    const result = this.db.transaction(() => {
      const season = this.db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId = ?').get(seasonId);
      if (!season || !['signup_closed','active','ended'].includes(season.Status)||season.Status==='ended'&&!input.eventId) fail('New schedules require a closed signup or active season', 409);
      const keys = this.teams(seasonId).map(t => t.TeamSubmissionId);
      const team1 = id(input.team1Key); const team2 = id(input.team2Key); const start = utc(input.scheduledStartUtc);
      if (!team1 || !team2 || team1 === team2 || !keys.includes(team1) || !keys.includes(team2)) fail('Select two teams from this season');
      if (!start || !['regular','tiebreaker','playoff'].includes(input.stage) || ![2,3,5].includes(Number(input.bestOf))) fail('Enter a valid date, stage and series format');
      if ((input.stage === 'regular' && Number(input.bestOf) !== 2) || (input.stage !== 'regular' && ![3,5].includes(Number(input.bestOf)))) fail('Groups use BO2; postseason uses BO3 or BO5');
      const timezone = input.timezone || 'America/New_York';
      if (typeof timezone !== 'string' || timezone.length > 60) fail('Invalid timezone');
      const status = input.status || 'scheduled';
      if (!['scheduled','started','completed','needs_review','cancelled','forfeit'].includes(status)) fail('Invalid fixture status');
      const previous = input.eventId ? this.get(id(input.eventId)) : null;
      if (input.eventId && (!previous || previous.SeasonId !== seasonId)) fail('Fixture not found', 404);
      if (previous && Number(input.revision) !== previous.Revision) fail('This fixture changed. Reload before saving.', 409, 'REVISION_CONFLICT');
      if (previous && ['cancelled','forfeit','replaced'].includes(previous.Status)) fail('Create a new fixture after cancellation or replacement', 409);
      const changedDefinition = previous && (previous.Team1Key !== team1 || previous.Team2Key !== team2 || previous.BestOf !== Number(input.bestOf) || previous.Stage !== input.stage);
      if (changedDefinition) {
        this.db.prepare("UPDATE ScheduledEvents SET Status = 'replaced', Revision = Revision + 1, UpdatedAtUtc = ? WHERE EventId = ?")
          .run(now.toISOString(), previous.EventId);
        this.revision(previous.EventId, actor, 'Teams or format changed');
      }
      let eventId;
      const startedAt = previous?.StartedAtUtc || (status === 'started' ? utc(input.startedAtUtc) || now.toISOString() : null);
      if (!previous || changedDefinition) {
        if (input.seriesId) fail('Link an actual series after creating the fixture');
        const row = this.db.prepare(`INSERT INTO ScheduledEvents (SeasonId,Team1Key,Team2Key,Stage,BestOf,ScheduledStartUtc,Timezone,Status,
          StartedAtUtc,SourceMessageId,CreatedAtUtc,UpdatedAtUtc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(seasonId, team1, team2, input.stage, Number(input.bestOf), start, timezone, status,
            status === 'started' ? utc(input.startedAtUtc) || now.toISOString() : null, input.sourceMessageId || null, now.toISOString(), now.toISOString());
        eventId = Number(row.lastInsertRowid);
      } else {
        eventId = previous.EventId;
        if (input.seriesId !== undefined && input.seriesId !== previous.SeriesId) {
          if(input.seriesId===null||input.seriesId==='')this.db.prepare('UPDATE ScheduledEvents SET SeriesId=NULL WHERE EventId=?').run(eventId);
          else {
          const seriesId = id(input.seriesId);
          const series = seriesId && this.db.prepare('SELECT * FROM SeriesInfo WHERE SeriesId = ?').get(seriesId);
          const teams = this.teams(seasonId);
          const external = [team1, team2].map(key => teams.find(t => t.TeamSubmissionId === key)?.ExternalTeamId);
          if (!series || series.LeagueId !== season.ExternalLeagueId || !external.includes(series.Team1) || !external.includes(series.Team2)
            || series.Team1 === series.Team2) fail('Actual series must have the same season and teams');
          this.db.prepare('UPDATE ScheduledEvents SET SeriesId = ? WHERE EventId = ?').run(seriesId, eventId);
          }
        }
        this.db.prepare(`UPDATE ScheduledEvents SET ScheduledStartUtc = ?, Timezone = ?, Status = ?, StartedAtUtc = ?,
          Revision = Revision + 1, UpdatedAtUtc = ? WHERE EventId = ?`).run(start, timezone,
            startedAt && status === 'scheduled' ? 'started' : status, startedAt, now.toISOString(), eventId);
      }
      this.revision(eventId, actor, previous ? 'Fixture updated' : 'Fixture created');
      this.audit('Schedule Changed', `Updated fixture ${eventId} for season ${seasonId}`);
      return this.get(eventId);
    })();
    this.changed(seasonId); return result;
  }
  markReview(eventId, reason, now = new Date()) {
    const event = this.get(eventId); if (!event || ['replaced','cancelled','forfeit'].includes(event.Status)) return;
    this.db.prepare("UPDATE ScheduledEvents SET Status = 'needs_review', Revision = Revision + 1, UpdatedAtUtc = ? WHERE EventId = ?")
      .run(now.toISOString(), eventId); this.revision(eventId, null, reason); this.changed(event.SeasonId);
  }
  ingest(message, seasonId, now = new Date()) {
    return this.db.transaction(() => {
      const hash = digest({ content: message.content, editedAt: message.editedAt || null, deleted: !!message.deleted });
      const previous = this.db.prepare('SELECT * FROM ScheduleMessages WHERE MessageId = ?').get(String(message.messageId));
      if(previous?.SeasonId&&previous.SeasonId!==seasonId)return {unchanged:true,eventId:previous.EventId,issue:'belongs_to_another_season'};
      if (previous?.ContentHash === hash && previous.ParserVersion === PARSER_VERSION
        && (previous.ParseStatus!=='needs_review'||previous.Deleted)) return { unchanged: true, eventId: previous.EventId };
      let parsed = message.deleted ? { error: 'message_deleted' } : parseScheduleMessage(message, this.teams(seasonId),
        this.db.prepare('SELECT * FROM TeamDiscordAliases WHERE SeasonId = ?').all(seasonId));
      const reply=message.replyTo ? this.db.prepare('SELECT EventId FROM ScheduleMessages WHERE MessageId=?').get(String(message.replyTo)) : null;
      let eventId = previous?.EventId || reply?.EventId || null;
      if(eventId&&this.get(eventId)?.SeasonId!==seasonId)return {unchanged:true,eventId,issue:'belongs_to_another_season'};
      if(parsed.error&&previous?.ContentHash===hash&&previous.ParserVersion===PARSER_VERSION&&previous.IssueCode===parsed.error) {
        this.db.prepare('UPDATE ScheduleMessages SET LastSeenAtUtc=? WHERE MessageId=?').run(now.toISOString(),String(message.messageId));
        return {unchanged:true,eventId,issue:parsed.error};
      }
      if(!eventId&&/\breschedul/i.test(message.content||''))parsed={error:'reschedule_needs_fixture_reference'};
      // A cancellation edit can omit its old date/team mentions; its persisted
      // message identity still identifies the fixture, never a pair/name lookup.
      if (eventId && /\b(cancelled|canceled|forfeit(?:ed)?)\b/i.test(message.content || '')) {
        const event = this.get(eventId);
        parsed = { team1Key: event.Team1Key, team2Key: event.Team2Key, stage: event.Stage, bestOf: event.BestOf,
          scheduledStartUtc: event.ScheduledStartUtc, timezone: event.Timezone,
          status: /forfeit/i.test(message.content) ? 'forfeit' : 'cancelled', assumptions: [] };
      }
      if (parsed.error && eventId) this.markReview(eventId, parsed.error, now);
      if (!parsed.error) {
        const event = eventId ? this.get(eventId) : null;
        try { eventId = this.save(seasonId, { ...parsed, eventId, revision: event?.Revision, sourceMessageId: String(message.messageId) }, null, now).EventId; }
        catch (error) { parsed = { error: error.code === 'REVISION_CONFLICT' ? 'revision_conflict' : 'fixture_needs_review' }; if (eventId) this.markReview(eventId, parsed.error, now); }
      }
      this.db.prepare(`INSERT INTO ScheduleMessages (ChannelId,MessageId,AuthoredAtUtc,EditedAtUtc,Content,ContentHash,ParserVersion,ParseStatus,IssueCode,AssumptionsJson,EventId,LastSeenAtUtc,Deleted,SeasonId)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(MessageId) DO UPDATE SET
        EditedAtUtc=excluded.EditedAtUtc, Content=excluded.Content, ContentHash=excluded.ContentHash, ParserVersion=excluded.ParserVersion,
        ParseStatus=excluded.ParseStatus, IssueCode=excluded.IssueCode, AssumptionsJson=excluded.AssumptionsJson,
        EventId=excluded.EventId, LastSeenAtUtc=excluded.LastSeenAtUtc, Deleted=excluded.Deleted,SeasonId=excluded.SeasonId`)
        .run(String(message.channelId), String(message.messageId), message.authoredAt, message.editedAt || null, String(message.content || '').slice(0, 10000),
          hash, PARSER_VERSION, parsed.error ? 'needs_review' : 'parsed', parsed.error || null, JSON.stringify(parsed.assumptions || []), eventId, now.toISOString(), message.deleted ? 1 : 0,seasonId);
      return { eventId, status: parsed.error ? 'needs_review' : 'parsed', issue: parsed.error || null };
    })();
  }
  setup(seasonId) { return this.db.prepare('SELECT * FROM SeasonBettingSetup WHERE SeasonId = ?').get(seasonId) || null; }
  rosterSlots(seasonId) {
    const season=this.db.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
    if(!season)return [];
    const roster=currentSeasonRoster(this.db,seasonId,season.Status), pending=currentPendingSlots(this.db,seasonId);
    return this.teams(seasonId).flatMap(team=>Array.from({length:5},(_,slot)=>{
      const player=roster.find(p=>p.TeamSubmissionId===team.TeamSubmissionId&&p.Slot===slot);
      const tbd=pending.find(p=>p.TeamSubmissionId===team.TeamSubmissionId&&p.Slot===slot);
      return {teamKey:team.TeamSubmissionId,slot,playerId:player?.PlayerId??null,
        name:player?this.db.prepare('SELECT PlayerName FROM PlayerInfo WHERE PlayerId=?').get(player.PlayerId)?.PlayerName:null,
        pending:!!tbd,estimatedMMR:tbd?.EstimatedMMR??null};
    }));
  }
  teamCaptains(seasonId) {
    if(!this.db.pragma('table_info(SeasonTeams)').some(c=>c.name==='CaptainId'))return [];
    return this.db.prepare(`SELECT t.TeamSubmissionId,t.CaptainId,p.PlayerName FROM SeasonTeams t
      LEFT JOIN PlayerInfo p ON p.PlayerId=t.CaptainId WHERE t.SeasonId=? ORDER BY t.TeamSubmissionId`).all(seasonId)
      .map(t=>({teamKey:t.TeamSubmissionId,captainId:id(t.CaptainId),
        captainName:id(t.CaptainId)?t.PlayerName||`Player ${t.CaptainId}`:null}));
  }
  changeCaptain(seasonId,{teamKey,captainId,expectedCaptainId},actor=null,now=new Date()) {
    teamKey=id(teamKey);captainId=id(captainId);
    if(!teamKey||!captainId||expectedCaptainId===undefined||expectedCaptainId!==null&&!id(expectedCaptainId))
      fail('Choose a team and captain using the current captain details');
    return this.db.transaction(()=>{
      const season=this.db.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
      const team=this.db.prepare('SELECT CaptainId FROM SeasonTeams WHERE TeamSubmissionId=? AND SeasonId=?').get(teamKey,seasonId);
      if(!['signup_closed','active'].includes(season?.Status)||!team)fail('Choose a team in the current season',409);
      if(id(team.CaptainId)!==id(expectedCaptainId))fail('The captain changed. Refresh before saving',409);
      if(!currentSeasonRoster(this.db,seasonId,season.Status).some(p=>p.TeamSubmissionId===teamKey&&p.PlayerId===captainId))
        fail('Choose a confirmed player on this team');
      if(id(team.CaptainId)!==captainId) {
        this.db.prepare('UPDATE SeasonTeams SET CaptainId=?,UpdatedAt=? WHERE TeamSubmissionId=?').run(captainId,now.toISOString(),teamKey);
        this.audit('Team Captain Changed',`Changed captain of team ${teamKey} in season ${seasonId} from ${team.CaptainId??'none'} to ${captainId}${actor==null?'':` by ${actor}`}`);
      }
      return {saved:true,captainId};
    }).immediate();
  }
  reorderRoster(seasonId,{teamKey,order,expectedRoster},actor=null) {
    teamKey=id(teamKey);
    if(!teamKey||!validRosterOrder(order)||!Array.isArray(expectedRoster)||expectedRoster.length!==5)fail('Provide all five roster positions once');
    return this.db.transaction(()=>{
      const season=this.db.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
      if(!['signup_closed','active'].includes(season?.Status)||!this.teams(seasonId).some(t=>t.TeamSubmissionId===teamKey))fail('Choose a team in the current season',409);
      const snapshot=slots=>slots.map(p=>[p.slot,p.playerId??null,!!p.pending]);
      const current=this.rosterSlots(seasonId).filter(p=>p.teamKey===teamKey);
      if(JSON.stringify(snapshot(current))!==JSON.stringify(snapshot(expectedRoster)))fail('The roster changed. Refresh before reordering it',409);
      this.db.prepare(`INSERT INTO TeamRosterDisplayOrder VALUES(?,?) ON CONFLICT(TeamSubmissionId)
        DO UPDATE SET OrderJson=excluded.OrderJson`).run(teamKey,JSON.stringify(order));
      this.audit('Roster Order Changed',`Reordered team ${teamKey} in season ${seasonId}${actor==null?'':` by ${actor}`}`);
      return {saved:true,order};
    })();
  }
  setPendingSlot(seasonId,{teamKey,slot,estimatedMMR,expectedPlayerId=null},actor=null,now=new Date()) {
    teamKey=id(teamKey);slot=Number(slot);estimatedMMR=Number(estimatedMMR);
    if(!teamKey||!Number.isInteger(slot)||slot<0||slot>4||!Number.isSafeInteger(estimatedMMR)||estimatedMMR<=5500)
      fail('Choose a team, slot, and estimated MMR above 5,500');
    const result=this.db.transaction(()=>{
      const season=this.db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
      if(!['active','signup_closed'].includes(season?.Status)||!this.teams(seasonId).some(t=>t.TeamSubmissionId===teamKey))fail('Choose a team in the current closed-signup or active season',409);
      if(this.list(seasonId).some(e=>e.Stage==='regular'&&!['cancelled','forfeit','replaced'].includes(e.Status)
        &&(e.StartedAtUtc||['started','completed'].includes(e.Status)||Date.parse(e.ScheduledStartUtc)<=now.getTime()))
        ||this.db.prepare('SELECT 1 FROM MatchLeague WHERE LeagueId=? LIMIT 1').get(season.ExternalLeagueId))
        fail('Declare pending slots before the season begins; use roster changes for confirmed players afterward',409);
      const previous=this.db.prepare('SELECT * FROM SeasonPendingRosterSlots WHERE TeamSubmissionId=? AND Slot=?').get(teamKey,slot);
      if(previous?.ConfirmedPlayerId)fail('This slot is already confirmed; use roster changes',409);
      const roster=currentSeasonRoster(this.db,seasonId,season.Status);
      const player=roster.find(p=>p.TeamSubmissionId===teamKey&&p.Slot===slot);
      if((player?.PlayerId??null)!==(expectedPlayerId==null?null:id(expectedPlayerId)))fail('The roster changed; refresh before editing this slot',409);
      if(player&&!conflictingRosterPlayers(roster).includes(player.PlayerId))fail('This is a confirmed player. Only an empty slot or duplicated placeholder can be marked TBD',409);
      this.db.prepare(`INSERT INTO SeasonPendingRosterSlots
        (TeamSubmissionId,Slot,EstimatedMMR,PlaceholderPlayerId,CreatedAtUtc,UpdatedAtUtc,ActorId) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(TeamSubmissionId,Slot) DO UPDATE SET EstimatedMMR=excluded.EstimatedMMR,UpdatedAtUtc=excluded.UpdatedAtUtc,ActorId=excluded.ActorId`)
        .run(teamKey,slot,estimatedMMR,player?.PlayerId??null,now.toISOString(),now.toISOString(),actor==null?null:String(actor));
      if(player&&season.Status==='active') {
        this.db.prepare('DELETE FROM TeamRosterPlayers WHERE TeamSubmissionId=? AND Slot=?').run(teamKey,slot);
        this.db.prepare('DELETE FROM TeamRosterMembershipHistory WHERE TeamSubmissionId=? AND PlayerId=? AND Slot=?').run(teamKey,player.PlayerId,slot);
      }
      this.audit('Player TBD Declared',`Season ${seasonId}, team ${teamKey}, slot ${slot+1}: Player TBD, estimated MMR ${estimatedMMR}${player?`, removed placeholder ${player.PlayerId}`:''}`);
      const setup=this.setup(seasonId);
      if(setup)this.finalizeSetup(seasonId,JSON.parse(setup.SetupJson).gamesByTeam?'group_round_robin':setup.RegularGamesPerTeam,actor,now);
      return {saved:true};
    })();this.changed(seasonId);return result;
  }
  confirmPendingSlot(seasonId,{teamKey,slot,playerId,mmr,effectiveAtUtc=null},actor=null,now=new Date()) {
    teamKey=id(teamKey);playerId=id(playerId);slot=Number(slot);mmr=Number(mmr);
    const at=effectiveAtUtc==null?now.toISOString():utc(effectiveAtUtc);
    if(!teamKey||!playerId||!Number.isInteger(slot)||slot<0||slot>4||!Number.isSafeInteger(mmr)||mmr<=5500||!at||Date.parse(at)>now.getTime())
      fail('Choose a pending slot, real player, MMR above 5,500, and valid effective time');
    const result=this.db.transaction(()=>{
      const season=this.db.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
      if(!['active','signup_closed'].includes(season?.Status)||!this.teams(seasonId).some(t=>t.TeamSubmissionId===teamKey))fail('Season is not open for roster confirmation',409);
      const pending=this.db.prepare('SELECT * FROM SeasonPendingRosterSlots WHERE TeamSubmissionId=? AND Slot=? AND ConfirmedPlayerId IS NULL').get(teamKey,slot);
      if(!pending)fail('Pending slot not found',404);
      if(Date.parse(at)<Date.parse(pending.CreatedAtUtc))fail('Effective time must be on or after the slot was marked TBD');
      if(!this.db.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId=?').get(playerId))fail('Select an existing player account',404);
      if(currentSeasonRoster(this.db,seasonId,season.Status).some(p=>p.PlayerId===playerId))fail('Player is already on a roster in this season',409);
      this.db.prepare(`UPDATE SeasonPendingRosterSlots SET ConfirmedPlayerId=?,ConfirmedMMR=?,ConfirmedAtUtc=?,UpdatedAtUtc=?,ActorId=?
        WHERE TeamSubmissionId=? AND Slot=?`).run(playerId,mmr,at,now.toISOString(),actor==null?null:String(actor),teamKey,slot);
      if(season.Status==='active') {
        this.db.prepare('INSERT INTO TeamRosterPlayers (TeamSubmissionId,PlayerId,Slot,FinalizedAt) VALUES(?,?,?,?)').run(teamKey,playerId,slot,at);
        this.db.prepare('INSERT INTO TeamRosterMembershipHistory (TeamSubmissionId,PlayerId,Slot,EffectiveFromUtc,FromEstimated) VALUES(?,?,?,?,0)').run(teamKey,playerId,slot,at);
        if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='SignupMMRs'").get())
          this.db.prepare('INSERT OR IGNORE INTO SignupMMRs (SeasonId,TeamSubmissionId,PlayerId,SignupMMR) VALUES(?,?,?,?)').run(seasonId,teamKey,playerId,mmr);
      }
      this.audit('Player TBD Confirmed',`Season ${seasonId}, team ${teamKey}, slot ${slot+1}: confirmed player ${playerId}, MMR ${mmr}, effective ${at}`);
      const setup=this.setup(seasonId);
      if(setup)this.finalizeSetup(seasonId,JSON.parse(setup.SetupJson).gamesByTeam?'group_round_robin':setup.RegularGamesPerTeam,actor,now);
      return {saved:true};
    })();this.changed(seasonId);return result;
  }
  finalizeSetup(seasonId, gamesPerTeam, actor = null, now = new Date()) {
    const roundRobin=gamesPerTeam==='group_round_robin';
    let games = roundRobin?null:id(gamesPerTeam); if (!roundRobin&&(!games || games < 5 || games > 100)) fail('Regular-season games per team must be between 5 and 100');
    const result = this.db.transaction(() => {
      const season = this.db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId = ?').get(seasonId);
      if (!season || !['signup_closed','active'].includes(season.Status)) fail('Close signups before finalizing setup', 409);
      const teams = this.teams(seasonId); if (teams.length < 2 || teams.some(t => !t.GroupId)) fail('Assign all teams to groups first');
      const gamesByTeam=roundRobin?Object.fromEntries(teams.map(t=>[t.TeamSubmissionId,2*(teams.filter(other=>other.GroupId===t.GroupId).length-1)])):null;
      if(roundRobin){games=Math.max(...Object.values(gamesByTeam));if(Object.values(gamesByTeam).some(n=>n<5||n>100))fail('Each BO2 group needs between 4 and 51 teams for season markets');}
      const roster = currentSeasonRoster(this.db, seasonId, season.Status);
      const pendingSlots = currentPendingSlots(this.db, seasonId);
      if (teams.some(t => {
        const players = roster.filter(p => p.TeamSubmissionId === t.TeamSubmissionId);
        const pending = pendingSlots.filter(p => p.TeamSubmissionId === t.TeamSubmissionId);
        if (t.IsManual && !players.length && !pending.length) return false;
        return players.length + pending.length !== 5 || new Set(players.map(p => p.PlayerId)).size !== players.length
          || new Set([...players,...pending].map(p=>p.Slot)).size !== 5;
      })) fail('Every team needs five distinct players within its own roster');
      const liveRules=season.ExternalLeagueId&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='LeagueRules'").get()
        ?this.db.prepare('SELECT * FROM LeagueRules WHERE LeagueId=?').get(season.ExternalLeagueId):null;
      const rules = liveRules||this.db.prepare('SELECT * FROM SeasonLeagueRules WHERE SeasonId=?').get(seasonId);
      if (!rules) fail('Save league qualification rules first');
      const previous = this.setup(seasonId);
      const snapshot = JSON.stringify({ teams: teams.map(({ TeamSubmissionId, GroupId }) => ({ TeamSubmissionId, GroupId })), roster, rules,
        ...(pendingSlots.length?{pendingSlots}:{}), ...(roundRobin?{gamesByTeam}: {}) });
      if(previous?.SetupJson===snapshot&&previous.RegularGamesPerTeam===games)return previous;
      this.db.prepare(`INSERT INTO SeasonBettingSetup VALUES (?,?,?, ?,?,'normal',0,?) ON CONFLICT(SeasonId) DO UPDATE SET
        Revision=excluded.Revision,RegularGamesPerTeam=excluded.RegularGamesPerTeam,FinalizedAtUtc=excluded.FinalizedAtUtc,
        SetupJson=excluded.SetupJson,UpdatedAtUtc=excluded.UpdatedAtUtc`).run(seasonId, (previous?.Revision || 0) + 1, games, now.toISOString(), snapshot, now.toISOString());
      this.audit('Betting Setup Finalized', `Finalized betting setup for season ${seasonId}: ${roundRobin?'BO2 group round robin':`${games} regular-season games per team`}`);
      return this.setup(seasonId);
    })(); this.changed(seasonId); return result;
  }
  completion(seasonId, { completion, regularSeasonComplete, outcomes = [] }, actor = null, now = new Date()) {
    if (!['normal','shortened','canceled'].includes(completion) || typeof regularSeasonComplete !== 'boolean') fail('Select a valid completion classification');
    if(!Array.isArray(outcomes)||outcomes.length>100)fail('Provide at most 100 official outcomes');
    if (!this.setup(seasonId)) fail('Finalize season betting setup first', 409);
    const teams = new Set(this.teams(seasonId).map(t => t.TeamSubmissionId));
    return this.db.transaction(() => {
      this.db.prepare('UPDATE SeasonBettingSetup SET Completion=?,RegularSeasonComplete=?,Revision=Revision+1,UpdatedAtUtc=? WHERE SeasonId=?')
        .run(completion, Number(regularSeasonComplete), now.toISOString(), seasonId);
      for (const o of outcomes) {
        if (!teams.has(Number(o.teamKey)) || !['placement','champion','elimination'].includes(o.type) || !['upper','lower','eliminated','champion','not_champion','finalist','not_finalist'].includes(o.value)) fail('Invalid official team outcome');
        this.db.prepare(`INSERT INTO BettingOfficialOutcomes VALUES (?,?,?,?,1,?) ON CONFLICT(SeasonId,OutcomeType,TeamSubmissionId)
          DO UPDATE SET OutcomeValue=excluded.OutcomeValue,Revision=Revision+1,UpdatedAtUtc=excluded.UpdatedAtUtc`)
          .run(seasonId, o.type, Number(o.teamKey), o.value, now.toISOString());
      }
      this.audit('Betting Outcomes Changed', `Updated official betting completion/outcomes for season ${seasonId}`);
      this.changed(seasonId); return this.setup(seasonId);
    })();
  }
  changeRoster(seasonId,{playerId,playerName='',fromTeamKey=null,toTeamKey=null,replacementPlayerId=null,replacementPlayerName='',slot=null,effectiveAtUtc,kind='permanent',reason},actor=null,now=new Date()) {
    this.syncRosterHistory();
    if([fromTeamKey,toTeamKey,replacementPlayerId].some(value=>value!==null&&value!==''&&!id(value)))fail('Enter valid player and team account IDs');
    playerId=id(playerId);fromTeamKey=id(fromTeamKey);toTeamKey=id(toTeamKey);replacementPlayerId=id(replacementPlayerId);
    const at=utc(effectiveAtUtc);
    if(!playerId||(!fromTeamKey&&!toTeamKey)||!at||Date.parse(at)>now.getTime()||!['permanent','data_correction'].includes(kind)
      ||typeof reason!=='string'||!reason.trim()||reason.length>500)fail('Select the player, effective time, change type and reason');
    if([playerName,replacementPlayerName].some(name=>typeof name!=='string'||name.trim().length>40))fail('Player names must be at most 40 characters');
    if(replacementPlayerId&&(!fromTeamKey||replacementPlayerId===playerId))fail('Choose a different replacement player for the outgoing team');
    const result=this.db.transaction(()=>{
      const season=this.db.prepare('SELECT Status FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
      if(season?.Status!=='active')fail('Roster changes require an active season',409);
      const teams=this.teams(seasonId);if([fromTeamKey,toTeamKey].filter(Boolean).some(key=>!teams.some(t=>t.TeamSubmissionId===key))||fromTeamKey&&fromTeamKey===toTeamKey)fail('Invalid roster teams');
      const player=this.db.prepare('SELECT PlayerId FROM PlayerInfo WHERE PlayerId=?').get(playerId);if(!player&&fromTeamKey)fail('Player not found',404);
      const active=this.db.prepare(`SELECT h.* FROM TeamRosterMembershipHistory h JOIN SeasonTeams t ON t.TeamSubmissionId=h.TeamSubmissionId
        WHERE t.SeasonId=? AND h.PlayerId=? AND h.EffectiveToUtc IS NULL`).all(seasonId,playerId);
      if(active.length>1||fromTeamKey&&!active.some(r=>r.TeamSubmissionId===fromTeamKey)||!fromTeamKey&&active.length)fail('Resolve the current roster membership before changing it',409);
      for(const membership of active) {
        if(at<=membership.EffectiveFromUtc)fail('Effective time must follow the current roster start');
        this.db.prepare('UPDATE TeamRosterMembershipHistory SET EffectiveToUtc=? WHERE MembershipId=?').run(at,membership.MembershipId);
        this.db.prepare('DELETE FROM TeamRosterPlayers WHERE TeamSubmissionId=? AND PlayerId=?').run(membership.TeamSubmissionId,playerId);
      }
      const add=(key,player,position,name)=>{
        if(!Number.isInteger(position)||position<0||position>4)fail('Select a roster slot from 1 to 5');
        if(this.db.prepare('SELECT 1 FROM TeamRosterPlayers WHERE TeamSubmissionId=? AND Slot=?').get(key,position))fail('The destination roster slot is occupied',409);
        if(this.db.prepare(`SELECT 1 FROM TeamRosterMembershipHistory h JOIN SeasonTeams t ON t.TeamSubmissionId=h.TeamSubmissionId
          WHERE t.SeasonId=? AND h.PlayerId=? AND h.EffectiveToUtc IS NULL`).get(seasonId,player))fail('Player is already on a roster',409);
        this.db.prepare('INSERT OR IGNORE INTO PlayerInfo(PlayerId,PlayerName) VALUES(?,?)').run(player,name.trim()||`Player ${player}`);
        this.db.prepare('INSERT INTO TeamRosterPlayers (TeamSubmissionId,PlayerId,Slot,FinalizedAt) VALUES (?,?,?,?)').run(key,player,position,now.toISOString());
        this.db.prepare('INSERT INTO TeamRosterMembershipHistory (TeamSubmissionId,PlayerId,Slot,EffectiveFromUtc,FromEstimated) VALUES (?,?,?,?,0)').run(key,player,position,at);
      };
      if(toTeamKey)add(toTeamKey,playerId,Number(slot),playerName);
      if(replacementPlayerId&&fromTeamKey)add(fromTeamKey,replacementPlayerId,active.find(r=>r.TeamSubmissionId===fromTeamKey).Slot,replacementPlayerName);
      const changed=this.db.prepare('INSERT INTO SeasonRosterChanges (SeasonId,PlayerId,FromTeamKey,ToTeamKey,EffectiveAtUtc,Kind,Reason,ActorId,CreatedAtUtc) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(seasonId,playerId,fromTeamKey,toTeamKey,at,kind,reason.trim(),actor==null?null:String(actor),now.toISOString());
      this.audit('Roster Changed',`${kind==='permanent'?'Permanent roster change':'Roster data correction'} for player ${playerId}, season ${seasonId}: ${reason.trim()}`);
      return {changeId:Number(changed.lastInsertRowid)};
    })();this.changed(seasonId);return result;
  }
  classifyMatch(seasonId,{matchId,status,replacementMatchId=null,stageOverride=null,reason},actor=null,now=new Date()) {
    matchId=id(matchId);replacementMatchId=id(replacementMatchId);
    if(!matchId||!['official','superseded','abandoned'].includes(status)||status==='superseded'&&(!replacementMatchId||replacementMatchId===matchId)
      ||stageOverride&&!['regular','tiebreaker','playoff'].includes(stageOverride)||typeof reason!=='string'||!reason.trim()||reason.length>500)fail('Enter a match, classification and reason');
    const result=this.db.transaction(()=>{
      const season=this.db.prepare('SELECT ExternalLeagueId FROM LeagueSeasons WHERE SeasonId=?').get(seasonId);
      const source=this.db.prepare('SELECT LeagueId FROM MatchLeague WHERE MatchId=?').get(matchId);
      if(!season||source?.LeagueId!==season.ExternalLeagueId)fail('The match must belong to this season');
      if(replacementMatchId&&this.db.prepare('SELECT LeagueId FROM MatchLeague WHERE MatchId=?').get(replacementMatchId)?.LeagueId!==season.ExternalLeagueId)fail('Replay match must belong to this season');
      if(replacementMatchId&&['superseded','abandoned'].includes(this.db.prepare('SELECT Status FROM OfficialMatchStatus WHERE MatchId=?').get(replacementMatchId)?.Status))fail('The replay must be an official match');
      if(replacementMatchId&&this.db.prepare('SELECT 1 FROM OfficialMatchStatus WHERE ReplacementMatchId=? AND MatchId=?').get(matchId,replacementMatchId))fail('Replay references cannot form a cycle');
      this.db.prepare(`INSERT INTO OfficialMatchStatus VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(MatchId) DO UPDATE SET Status=excluded.Status,
        ReplacementMatchId=excluded.ReplacementMatchId,StageOverride=excluded.StageOverride,Reason=excluded.Reason,ActorId=excluded.ActorId,UpdatedAtUtc=excluded.UpdatedAtUtc`)
        .run(matchId,seasonId,status,replacementMatchId,stageOverride,reason.trim(),actor==null?null:String(actor),now.toISOString());
      this.audit('Official Match Classified',`Classified match ${matchId} as ${status}${replacementMatchId?`, replay ${replacementMatchId}`:''}: ${reason.trim()}`);
      return {saved:true};
    })();this.changed(seasonId);return result;
  }
}
