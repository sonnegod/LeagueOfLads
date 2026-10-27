import { seedDraftPatches, readDraftMeta } from './draftMeta.js';
import { buildDraftHistory } from './draftHistory.js';
import { buildDraftIntelligence } from './draftIntelligence.js';
import { metaWeight, patchAt } from '../shared/metaPolicy.js';
import { DEFAULT_FORMAT, MODEL_VERSION, TRAITS, validateDraftState } from '../shared/draftModel.js';
import { ensureRosterDisplayOrderSchema, readRosterOrder } from './rosterDisplayOrder.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export default class DraftGodStore {
  constructor(db, publicDb, { now = () => Date.now() } = {}) {
    this.db = db; this.publicDb = publicDb; this.now = now; this.cache = new Map();
    ensureRosterDisplayOrderSchema(db);
    seedDraftPatches(db);
    db.exec(`CREATE TABLE IF NOT EXISTS DraftGodDrafts (
      DraftId INTEGER PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL,
      StateJson TEXT NOT NULL, Revision INTEGER NOT NULL DEFAULT 1,
      CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS DraftGodHeroProfiles (
        HeroId INTEGER PRIMARY KEY REFERENCES HeroInfo(HeroId), RolesJson TEXT NOT NULL,
        TagsJson TEXT NOT NULL, UpdatedAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_PickInfo_MatchId ON PickInfo(MatchId);
      CREATE INDEX IF NOT EXISTS idx_MatchLeague_LeagueId_MatchId ON MatchLeague(LeagueId, MatchId);
      CREATE INDEX IF NOT EXISTS idx_MatchPlayer_MatchId_PlayerId ON MatchPlayer(MatchId, PlayerId);
      CREATE INDEX IF NOT EXISTS idx_MatchTeamPlayer_MatchId_PlayerId_TeamId ON MatchTeamPlayer(MatchId, PlayerId, TeamId);`);
  }

  getSeason(id) {
    const season = this.db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId = ?').get(id);
    if (!season) fail('Season not found', 404);
    return season;
  }

  teams(season) {
    const submissions = this.db.prepare(`SELECT t.TeamSubmissionId, t.TeamName, t.ExternalTeamId,
      g.GroupName FROM SeasonTeams t LEFT JOIN SeasonGroups g ON g.GroupId = t.GroupId
      WHERE t.SeasonId = ? ORDER BY g.SortOrder, t.TeamName COLLATE NOCASE`).all(season.SeasonId);
    const list = submissions.map(t => ({ key: `s${t.TeamSubmissionId}`, name: t.TeamName,
      teamId: t.ExternalTeamId, submissionId: t.TeamSubmissionId, group: t.GroupName || '' }));
    if (season.ExternalLeagueId) {
      const matched = this.db.prepare(`SELECT ids.TeamId,
        COALESCE(n.DisplayName, r.DisplayName, ti.TeamName, 'Team ' || ids.TeamId) TeamName,
        g.GroupName FROM (SELECT TeamRad TeamId FROM MatchTeam m JOIN MatchLeague ml ON ml.MatchId = m.MatchId WHERE ml.LeagueId = ?
        UNION SELECT TeamDire FROM MatchTeam m JOIN MatchLeague ml ON ml.MatchId = m.MatchId WHERE ml.LeagueId = ?) ids
        LEFT JOIN TeamInfo ti ON ti.TeamId = ids.TeamId
        LEFT JOIN LeagueTeamNames n ON n.TeamId = ids.TeamId AND n.LeagueId = ?
        LEFT JOIN LeagueRosterEntries r ON r.TeamId = ids.TeamId AND r.LeagueId = ?
        LEFT JOIN GroupNames g ON g.GroupId = r.GroupId AND g.LeagueId = r.LeagueId
        WHERE ids.TeamId > 0 ORDER BY TeamName COLLATE NOCASE`)
        .all(season.ExternalLeagueId, season.ExternalLeagueId, season.ExternalLeagueId, season.ExternalLeagueId);
      for (const t of matched) if (!list.some(row => row.teamId === t.TeamId)) {
        list.push({ key: `t${t.TeamId}`, teamId: t.TeamId, name: t.TeamName, group: t.GroupName || '' });
      }
    }
    return list;
  }

  roster(season, team) {
    if (team.submissionId) {
      let rows = this.db.prepare('SELECT PlayerId, Slot FROM TeamRosterPlayers WHERE TeamSubmissionId = ? ORDER BY Slot').all(team.submissionId);
      if (!rows.length) rows = this.db.prepare('SELECT PlayerId, Slot FROM SeasonTeamPlayers WHERE TeamSubmissionId = ? ORDER BY Slot').all(team.submissionId);
      const order = readRosterOrder(this.db, team.submissionId);
      rows.sort((a, b) => order.indexOf(a.Slot) - order.indexOf(b.Slot));
      if (rows.length) return { source: 'signup', players: this.names(rows.map(p => p.PlayerId)) };
    }
    if (!team.teamId || !season.ExternalLeagueId) return { source: 'unknown', players: [] };
    const confirmed = this.db.prepare(`SELECT PlayerId FROM ChampionshipRosterPlayers
      WHERE SeasonId = ? AND TeamId = ? ORDER BY Slot`).all(season.SeasonId, team.teamId);
    const rows = this.db.prepare(`SELECT p.PlayerId, COUNT(DISTINCT p.MatchId) Games
      FROM MatchLeague ml JOIN MatchTeamPlayer p ON p.MatchId = ml.MatchId
      JOIN MatchTeam m ON m.MatchId = ml.MatchId
      WHERE ml.LeagueId = ? AND p.TeamId = ? AND p.TeamId IN (m.TeamRad, m.TeamDire) AND p.PlayerId > 0
      GROUP BY p.PlayerId ORDER BY Games DESC, p.PlayerId`).all(season.ExternalLeagueId, team.teamId);
    const order = [...confirmed.map(p => p.PlayerId), ...rows.map(p => p.PlayerId)];
    return { source: confirmed.length ? 'championship' : 'observed', players: this.names([...new Set(order)])
      .map(p => ({ ...p, games: rows.find(r => r.PlayerId === p.id)?.Games || 0 })) };
  }

  names(ids) {
    const get = this.db.prepare('SELECT CAST(PlayerName AS TEXT) name FROM PlayerInfo WHERE PlayerId = ?');
    return ids.map(id => ({ id, name: get.get(id)?.name || `Player ${id}` }));
  }

  setup(seasonId) {
    const seasons = this.db.prepare(`SELECT SeasonId id, LeagueName name, Status status, ExternalLeagueId leagueId
      FROM LeagueSeasons ORDER BY (Status <> 'ended') DESC, ExternalLeagueId DESC, SeasonId DESC`).all();
    const id = seasonId || seasons[0]?.id;
    if (!id) return { seasons, teams: [], seasonId: null, heroes: [], format: DEFAULT_FORMAT };
    const season = this.getSeason(id);
    const teams = this.teams(season).map(team => ({ ...team, roster: this.roster(season, team) }));
    const ourTeam = [...teams].filter(t => t.roster.players.some(p => p.id === 49219700))
      .sort((a, b) => Number(b.roster.source === 'signup') - Number(a.roster.source === 'signup')
        || (b.roster.players.find(p => p.id === 49219700)?.games || 0) - (a.roster.players.find(p => p.id === 49219700)?.games || 0))[0]?.key || teams[0]?.key || '';
    return { seasons, seasonId: id, teams, ourTeam, opponentTeam: teams.find(t => t.key !== ourTeam)?.key || '',
      heroes: this.db.prepare('SELECT HeroId id, HeroName name FROM HeroInfo ORDER BY HeroName').all(), format: DEFAULT_FORMAT };
  }

  searchPlayers(query) {
    const search = String(query || '').trim().slice(0, 60);
    if (search.length < 2) return [];
    const escaped = search.replace(/[\\%_]/g, '\\$&');
    return this.db.prepare(`SELECT PlayerId id, CAST(PlayerName AS TEXT) name FROM PlayerInfo
      WHERE PlayerId > 0 AND (CAST(PlayerId AS TEXT) LIKE ? ESCAPE '\\' OR PlayerName LIKE ? ESCAPE '\\')
      ORDER BY PlayerName COLLATE NOCASE LIMIT 30`).all(`%${escaped}%`, `%${escaped}%`);
  }

  history(season, asOf, mode = 'adaptive') {
    const revision = this.db.pragma('data_version', { simple: true }) + ':' + this.db.prepare('SELECT total_changes() n').get().n;
    const leagueId = season.ExternalLeagueId || this.db.prepare('SELECT MAX(LeagueId) id FROM LeagueInfo').get().id || 0;
    const key = [leagueId,asOf,mode,revision].join(':');
    const cached = this.cache.get(key);
    if (cached && this.now()-cached.time<60000) return cached.value;
    const meta=readDraftMeta(this.db,asOf);
    const value=buildDraftHistory(this.db,leagueId,asOf,meta,mode); value.meta=meta;
    if(this.cache.size>=3)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key,{value,time:this.now()});return value;
  }

  context(config) {
    try { validateDraftState({ version: 1, config, board: [] }); } catch (e) { fail(e.message); }
    config={...config,asOf:new Date(config.asOf).toISOString()};
    if (Date.parse(config.asOf) > this.now() + 60000) fail('The data cutoff cannot be in the future.');
    const season = this.getSeason(config.seasonId), teams = this.teams(season);
    const our = teams.find(t => t.key === config.ourTeam), opponent = teams.find(t => t.key === config.opponentTeam);
    if (!our || !opponent) fail('Choose teams from this season.');
    const ids = [...config.lineups.our, ...config.lineups.opponent].map(p => p.id);
    const known = this.names(ids);
    for (const id of ids) if (!this.db.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId = ?').get(id)) fail(`Player ${id} is not in PlayerInfo.`);
    const history = this.history(season, config.asOf, config.metaMode || 'adaptive'), players = {};
    for (const player of known) {
      const row = history.players[player.id];
      players[player.id] = { ...player, games: row?.games || 0, wins: row?.wins || 0, effectiveGames: row?.effectiveGames || 0, practiceGames:row?.practiceGames || 0,
        heroes: Object.values(row?.heroes || {}).sort((a, b) => b.games - a.games), publicHeroes: [], publicGames: 0, publicFresh: false };
    }
    let publicStatus = { status: 'unavailable', latestMatchAt: null, lastSuccessAt: null };
    try {
      const from = new Date(Date.parse(config.asOf) - 30 * 86400000).toISOString();
      const placeholders = ids.map(() => '?').join(',');
      const rows = this.publicDb.prepare(`SELECT PlayerId, HeroId, Won, DateCreated FROM PublicMatchPlayer
        WHERE PlayerId IN (${placeholders}) AND DateCreated >= ? AND DateCreated < ?`).all(...ids, from, config.asOf);
      const latest = this.publicDb.prepare('SELECT MAX(DateCreated) latest FROM PublicMatchPlayer').get().latest;
      const syncExists = this.publicDb.prepare("SELECT 1 FROM sqlite_master WHERE name='PublicPlayerSync'").get();
      const syncs = syncExists ? this.publicDb.prepare(`SELECT * FROM PublicPlayerSync WHERE PlayerId IN (${placeholders})`).all(...ids) : [];
      const baselineRows = this.publicDb.prepare(`SELECT HeroId, COUNT(*) games, SUM(Won) wins FROM PublicMatchPlayer
        WHERE DateCreated >= ? AND DateCreated < ? GROUP BY HeroId`).all(from, config.asOf);
      const baselines = new Map(baselineRows.map(r => [r.HeroId, (r.wins + 6) / (r.games + 12)]));
      for (const id of ids) {
        const player = players[id], aggregate = new Map();
        for (const row of rows.filter(r => r.PlayerId === id)) {
          const h = aggregate.get(row.HeroId) || { id: row.HeroId, games: 0, wins: 0, weightedGames: 0, weightedWins: 0, baseline: baselines.get(row.HeroId) || .5 };
          const transfer=metaWeight(history.meta,{date:row.DateCreated,heroes:[row.HeroId],mode:config.metaMode || 'adaptive'});
          const decay = 2 ** (-(Date.parse(config.asOf) - Date.parse(row.DateCreated)) / (14 * 86400000)) * transfer.outcome;
          h.games++; h.wins += row.Won; h.weightedGames += decay; h.weightedWins += decay * row.Won; aggregate.set(row.HeroId, h);
        }
        const success = syncs.find(s => s.PlayerId === id)?.LastSuccessAt;
        // Historical observations are usable at their cutoff; live data requires recent collection or recent matches.
        const historical = this.now() - Date.parse(config.asOf) > 2 * 86400000;
        const last = rows.filter(r => r.PlayerId === id).map(r => r.DateCreated).sort().at(-1);
        player.publicFresh = historical || Boolean(success && this.now() - Date.parse(success) < 48 * 3600000)
          || Boolean(last && this.now() - Date.parse(last) < 48 * 3600000);
        player.lastPublicSuccessAt = success || null;
        player.publicHeroes = [...aggregate.values()].sort((a, b) => b.games - a.games);
        player.publicGames = player.publicHeroes.reduce((sum, h) => sum + h.games, 0);
      }
      const lastSuccessAt = syncs.map(s => s.LastSuccessAt).filter(Boolean).sort().at(-1) || null;
      publicStatus = { status: ids.every(id => players[id].publicFresh) ? 'fresh' : 'partial / stale', latestMatchAt: latest, lastSuccessAt };
    } catch { /* League-only analysis remains available with explicit public-data status. */ }
    const heroProfiles = Object.fromEntries(this.db.prepare('SELECT * FROM DraftGodHeroProfiles WHERE UpdatedAt <= ?').all(config.asOf)
      .filter(r => patchAt(history.meta.patches,r.UpdatedAt)?.key===history.meta.current?.key)
      .map(r => [r.HeroId, { roles: JSON.parse(r.RolesJson), tags: JSON.parse(r.TagsJson), updatedAt: r.UpdatedAt }]));
    if (history.meta.current) for (const r of this.db.prepare('SELECT * FROM DraftGodHeroProfileVersions WHERE PatchKey=?').all(history.meta.current.key)) {
      heroProfiles[r.HeroId]={roles:JSON.parse(r.RolesJson),tags:JSON.parse(r.TagsJson),updatedAt:r.UpdatedAt,patch:r.PatchKey};
    }
    const intelligence=buildDraftIntelligence(history,config,{our:our.teamId,opponent:opponent.teamId},history.meta);
    return { meta: { ...history.meta, stale:!history.meta.checkedAt || this.now()-Date.parse(history.meta.checkedAt)>7*86400000,
      patches:history.meta.patches.map(({heroes,...p})=>({...p,changedHeroes:Object.keys(heroes).length})), mode:config.metaMode || 'adaptive', counts:history.patchCounts }, intelligence,
      modelVersion: MODEL_VERSION, generatedAt: new Date(this.now()).toISOString(), asOf: config.asOf,
      season: { id: season.SeasonId, name: season.LeagueName },
      heroes: this.db.prepare('SELECT HeroId id, HeroName name FROM HeroInfo ORDER BY HeroName').all(),
      players, heroProfiles, matchups: Object.fromEntries(Object.entries(history.matchups).filter(([,r])=>r.effectiveGames>=5)),
      teams: { [our.key]: { ...(history.teams[our.teamId] || { games: 0, heroes: {}, pairs: {}, bans: {} }), name: our.name },
        [opponent.key]: { ...(history.teams[opponent.teamId] || { games: 0, heroes: {}, pairs: {}, bans: {} }), name: opponent.name } },
      coverage: { matches: history.matches, leagues: history.leagues, excludedUndated: history.excludedUndated,
        public: publicStatus, rosterConfirmed: true } };
  }

  listDrafts() {
    return this.db.prepare('SELECT DraftId id, Name name, Revision revision, UpdatedAt updatedAt FROM DraftGodDrafts ORDER BY UpdatedAt DESC LIMIT 50').all();
  }
  getDraft(id) {
    const row = this.db.prepare('SELECT * FROM DraftGodDrafts WHERE DraftId = ?').get(id);
    if (!row) fail('Draft not found', 404);
    return { id: row.DraftId, name: row.Name, revision: row.Revision, state: JSON.parse(row.StateJson), updatedAt: row.UpdatedAt };
  }
  saveDraft(id, input) {
    const name = String(input?.name || '').trim();
    if (!name || name.length > 100) fail('Give this draft a name of up to 100 characters.');
    try { validateDraftState(input?.state); } catch (e) { fail(e.message); }
    const state = JSON.stringify(input.state);
    if (Buffer.byteLength(state) > 65536) fail('Saved draft is too large.');
    const heroes = new Set(this.db.prepare('SELECT HeroId FROM HeroInfo').all().map(h => h.HeroId));
    if ([input.state.board, ...(input.state.undo || []), ...(input.state.redo || [])].some(board => board.some(p => !heroes.has(p.heroId)))) fail('Unknown hero in draft.');
    // Resolve team and player references without rebuilding the analytical context.
    const teams = this.teams(this.getSeason(input.state.config.seasonId));
    if (![input.state.config.ourTeam, input.state.config.opponentTeam].every(key => teams.some(t => t.key === key))) fail('Unknown season team.');
    for (const p of [...input.state.config.lineups.our, ...input.state.config.lineups.opponent]) {
      if (!this.db.prepare('SELECT 1 FROM PlayerInfo WHERE PlayerId = ?').get(p.id)) fail('Unknown lineup player.');
    }
    const now = new Date(this.now()).toISOString();
    if (!id) {
      const result = this.db.prepare('INSERT INTO DraftGodDrafts (Name,StateJson,CreatedAt,UpdatedAt) VALUES (?,?,?,?)').run(name, state, now, now);
      return this.getDraft(Number(result.lastInsertRowid));
    }
    if (!Number.isSafeInteger(input.revision)) fail('Reload the saved draft before editing.', 409);
    if (!this.db.prepare('UPDATE DraftGodDrafts SET Name=?,StateJson=?,Revision=Revision+1,UpdatedAt=? WHERE DraftId=? AND Revision=?')
      .run(name, state, now, id, input.revision).changes) fail('This draft changed in another tab. Reopen it or save a new scenario.', 409);
    return this.getDraft(id);
  }
  deleteDraft(id) {
    if (!this.db.prepare('DELETE FROM DraftGodDrafts WHERE DraftId=?').run(id).changes) fail('Draft not found', 404);
  }
  saveHeroProfile(id, input) {
    if (!this.db.prepare('SELECT 1 FROM HeroInfo WHERE HeroId=?').get(id)) fail('Hero not found', 404);
    const roles = input?.roles, tags = input?.tags;
    if (!Array.isArray(roles) || !Array.isArray(tags) || roles.length > 5 || tags.length > TRAITS.length
      || roles.some(r => !Number.isInteger(r) || r < 1 || r > 5) || tags.some(t => !TRAITS.includes(t))
      || new Set(roles).size !== roles.length || new Set(tags).size !== tags.length) fail('Choose valid positions and composition traits.');
    if(input.patch) {
      if(typeof input.patch!=='string' || input.patch.length>20) fail('Choose a valid patch.');
      if(!this.db.prepare('SELECT 1 FROM DraftGodPatches WHERE PatchKey=?').get(input.patch)) fail('Unknown patch.');
      this.db.prepare('INSERT INTO DraftGodHeroProfileVersions VALUES (?,?,?,?,?) ON CONFLICT(HeroId,PatchKey) DO UPDATE SET RolesJson=excluded.RolesJson,TagsJson=excluded.TagsJson,UpdatedAt=excluded.UpdatedAt')
        .run(id,input.patch,JSON.stringify(roles),JSON.stringify(tags),new Date(this.now()).toISOString());
      this.cache.clear();return {roles,tags,patch:input.patch};
    }
    this.db.prepare(`INSERT INTO DraftGodHeroProfiles VALUES (?,?,?,?) ON CONFLICT(HeroId) DO UPDATE
      SET RolesJson=excluded.RolesJson,TagsJson=excluded.TagsJson,UpdatedAt=excluded.UpdatedAt`)
      .run(id, JSON.stringify(roles), JSON.stringify(tags), new Date(this.now()).toISOString());
    this.cache.clear(); return { roles, tags };
  }
  saveMetaOverride(patch,input) {
    if(!this.db.prepare('SELECT 1 FROM DraftGodPatches WHERE PatchKey=?').get(patch)) fail('Unknown patch.');
    const heroId=input?.heroId ?? 0, transfer=input?.transfer, note=String(input?.note || '').trim();
    if(!Number.isSafeInteger(heroId)||heroId<0 || (heroId && !this.db.prepare('SELECT 1 FROM HeroInfo WHERE HeroId=?').get(heroId))) fail('Choose a valid hero or all heroes.');
    if(transfer===null){this.db.prepare('DELETE FROM DraftGodMetaOverrides WHERE PatchKey=? AND HeroId=?').run(patch,heroId);this.cache.clear();return {success:true};}
    if(typeof transfer!=='number'||!Number.isFinite(transfer)||transfer<0||transfer>1||!note||note.length>300) fail('Use a transfer from 0 to 1 and a reason of up to 300 characters.');
    this.db.prepare('INSERT INTO DraftGodMetaOverrides VALUES (?,?,?,?,?) ON CONFLICT(PatchKey,HeroId) DO UPDATE SET Transfer=excluded.Transfer,Note=excluded.Note,UpdatedAt=excluded.UpdatedAt')
      .run(patch,heroId,transfer,note,new Date(this.now()).toISOString());this.cache.clear();return {success:true};
  }
}
