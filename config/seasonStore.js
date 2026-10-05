import { randomizeGroups, groupSpread } from './groupRandomizer.js';
import { DEFAULT_LEAGUE_RULES, normalizeLeagueRules } from './leagueRules.js';

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function now() { return new Date().toISOString(); }

export function normalizeProfileUrl(value) {
  let input = String(value || '').trim().replace(/\s+/g, '');
  if (!input) fail('Each player needs a valid profile URL');
  input = input.replace(/^(https?):?\/{1,2}/i, '$1://');
  if (input.startsWith('//')) input = `https:${input}`;
  else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let url;
  try { url = new URL(input); }
  catch { fail('Each player needs a valid profile URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) {
    fail('Each player needs a valid profile URL');
  }

  const normalized = url.toString();
  if (normalized.length > 500) fail('Each player needs a valid profile URL');
  return normalized;
}

function assignChampionSpotlights(players) {
  const categories = [
    { key: 'healing', label: 'Keeping the team alive', unit: 'healing in one match', minimum: 300 },
    { key: 'towerDamage', label: 'Siege work', unit: 'tower damage in one match', minimum: 1000 },
    { key: 'heroPool', label: 'Flexible draft', unit: 'different heroes played', minimum: 2 },
    { key: 'gpm', label: 'Gold pace', unit: 'gold per minute in one match', minimum: 400 },
    { key: 'lastHits', label: 'Farm game', unit: 'last hits in one match', minimum: 150 },
    { key: 'heroDamage', label: 'Damage dealt', unit: 'hero damage in one match', minimum: 10000 },
  ];
  for (const category of categories) {
    const available = players.filter(player => !player.spotlight)
      .map(player => ({ player, best: category.key === 'heroPool'
        ? { value: player.heroes.size } : player.bestMatches[category.key] }))
      .filter(({ best }) => best && best.value >= category.minimum)
      .sort((a, b) => b.best.value - a.best.value || b.player.games - a.player.games);
    if (!available.length) continue;
    const { player, best } = available[0];
    player.spotlight = { label: category.label, value: best.value, unit: category.unit,
      ...(best.matchId ? { matchId: best.matchId, stage: best.stage,
        opponentName: best.opponentName } : {}) };
  }
  for (const player of players) {
    if (player.spotlight) continue;
    player.spotlight = player.playoffWins > 0
      ? { label: 'Playoff run', value: player.playoffWins, unit: 'playoff wins' }
      : { label: 'Title run', value: player.wins, unit: 'wins with the champions' };
  }
}

export default class SeasonStore {
  constructor(db, audit = () => {}) {
    this.db = db;
    this.audit = audit;
    db.exec(`
      CREATE TABLE IF NOT EXISTS LeagueSeasons (
        SeasonId INTEGER PRIMARY KEY AUTOINCREMENT,
        LeagueName TEXT NOT NULL,
        Status TEXT NOT NULL CHECK (Status IN ('draft', 'signup_open', 'signup_closed', 'active', 'ended')),
        SignupTitle TEXT,
        SignupDescription TEXT,
        ExternalLeagueId INTEGER UNIQUE,
        ChampionTeamId INTEGER,
        CreatedAt TEXT NOT NULL,
        UpdatedAt TEXT NOT NULL,
        EndedAt TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_LeagueSeasons_Current
        ON LeagueSeasons ((1)) WHERE Status <> 'ended';
      CREATE TABLE IF NOT EXISTS SeasonGroups (
        GroupId INTEGER PRIMARY KEY AUTOINCREMENT,
        SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
        GroupName TEXT NOT NULL COLLATE NOCASE,
        SortOrder INTEGER NOT NULL,
        UNIQUE (SeasonId, GroupName)
      );
      CREATE TABLE IF NOT EXISTS SeasonTeams (
        TeamSubmissionId INTEGER PRIMARY KEY AUTOINCREMENT,
        SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
        CaptainId INTEGER,
        TeamName TEXT NOT NULL,
        IsManual INTEGER NOT NULL DEFAULT 0 CHECK (IsManual IN (0, 1)),
        ManualAverageMMR INTEGER,
        GroupId INTEGER REFERENCES SeasonGroups(GroupId),
        ExternalTeamId INTEGER,
        SubmittedAt TEXT NOT NULL,
        UpdatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS SeasonTeamPlayers (
        TeamSubmissionId INTEGER NOT NULL REFERENCES SeasonTeams(TeamSubmissionId),
        PlayerId INTEGER NOT NULL REFERENCES PlayerInfo(PlayerId),
        Slot INTEGER NOT NULL,
        MMR INTEGER NOT NULL,
        DotaProfileUrl TEXT NOT NULL,
        ScreenshotMime TEXT NOT NULL,
        ScreenshotData BLOB NOT NULL,
        PRIMARY KEY (TeamSubmissionId, PlayerId),
        UNIQUE (TeamSubmissionId, Slot)
      );
      CREATE TABLE IF NOT EXISTS SignupMMRs (
        SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
        TeamSubmissionId INTEGER NOT NULL REFERENCES SeasonTeams(TeamSubmissionId),
        PlayerId INTEGER NOT NULL REFERENCES PlayerInfo(PlayerId),
        SignupMMR INTEGER NOT NULL,
        PRIMARY KEY (TeamSubmissionId, PlayerId)
      );
      CREATE TABLE IF NOT EXISTS SeasonLeagueRules (
        SeasonId INTEGER PRIMARY KEY REFERENCES LeagueSeasons(SeasonId),
        UpperBracketTeams INTEGER NOT NULL,
        LowerBracketTeams INTEGER NOT NULL,
        EliminatedTeams INTEGER NOT NULL,
        HasTiebreaker INTEGER NOT NULL,
        TiebreakerPosition INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_SeasonTeams_Season ON SeasonTeams(SeasonId);
      CREATE INDEX IF NOT EXISTS idx_SeasonGroups_Season ON SeasonGroups(SeasonId);
    `);
    const active = db.prepare('SELECT LeagueId, LeagueName FROM LeagueInfo WHERE Active = 1 LIMIT 1').get();
    if (active && !db.prepare('SELECT 1 FROM LeagueSeasons WHERE ExternalLeagueId = ?').get(active.LeagueId)) {
      db.prepare(`INSERT INTO LeagueSeasons (LeagueName, Status, ExternalLeagueId, CreatedAt, UpdatedAt)
        VALUES (?, 'active', ?, ?, ?)`).run(active.LeagueName, active.LeagueId, now(), now());
    }
    const latestCompleted = db.prepare(`SELECT li.LeagueId, li.LeagueName FROM LeagueInfo li
      WHERE li.Active = 0 AND NOT EXISTS (SELECT 1 FROM LeagueSeasons WHERE Status = 'ended')
      ORDER BY COALESCE((SELECT MAX(ml.DatePlayed) FROM MatchLeague ml
        WHERE ml.LeagueId = li.LeagueId), '') DESC, li.LeagueId DESC LIMIT 1`).get();
    if (latestCompleted) {
      const timestamp = now();
      db.prepare(`INSERT INTO LeagueSeasons
        (LeagueName, Status, ExternalLeagueId, CreatedAt, UpdatedAt, EndedAt)
        VALUES (?, 'ended', ?, ?, ?, ?)`).run(latestCompleted.LeagueName,
          latestCompleted.LeagueId, timestamp, timestamp, timestamp);
    }
  }

  current() {
    return this.db.prepare(`SELECT * FROM LeagueSeasons WHERE Status <> 'ended'
      ORDER BY SeasonId DESC LIMIT 1`).get() || null;
  }

  get(seasonId) {
    return this.db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId = ?').get(seasonId) || null;
  }

  lastEnded() {
    return this.db.prepare(`SELECT * FROM LeagueSeasons WHERE Status = 'ended'
      ORDER BY EndedAt DESC, SeasonId DESC LIMIT 1`).get() || null;
  }

  create(leagueName, externalLeagueId = null) {
    return this.db.transaction(() => {
      if (this.current() || this.db.prepare('SELECT 1 FROM LeagueInfo WHERE Active = 1 LIMIT 1').get()) {
        fail('End the current league before creating another', 409);
      }
      if (externalLeagueId !== null) {
        if (!Number.isSafeInteger(externalLeagueId) || externalLeagueId <= 0) fail('Enter a valid external League ID');
        if (this.db.prepare('SELECT 1 FROM LeagueInfo WHERE LeagueId = ?').get(externalLeagueId) ||
          this.db.prepare('SELECT 1 FROM LeagueSeasons WHERE ExternalLeagueId = ?').get(externalLeagueId)) {
          fail('League ID already exists', 409);
        }
      }
      const timestamp = now();
      const result = this.db.prepare(`INSERT INTO LeagueSeasons
        (LeagueName, Status, ExternalLeagueId, CreatedAt, UpdatedAt) VALUES (?, 'draft', ?, ?, ?)`)
        .run(leagueName, externalLeagueId, timestamp, timestamp);
      const season = this.get(result.lastInsertRowid);
      this.audit('Season Created', `Created ${leagueName} (season ${season.SeasonId}${externalLeagueId ?
        `, league ${externalLeagueId}` : ''})`);
      return season;
    })();
  }

  saveSignup(seasonId, title, description) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'draft') fail('Signup details can only be edited before signups open', 409);
      this.db.prepare(`UPDATE LeagueSeasons SET SignupTitle = ?, SignupDescription = ?, UpdatedAt = ?
        WHERE SeasonId = ?`).run(title, description, now(), seasonId);
      this.audit('Signup Details Changed', `Updated signup details for season ${seasonId}`);
      return this.get(seasonId);
    })();
  }

  setSignupStatus(seasonId, open) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (open && season.Status !== 'draft') fail('Only draft signups can be opened', 409);
      if (!open && season.Status !== 'signup_open') fail('Signups are not open', 409);
      if (open && (!season.SignupTitle || !season.SignupDescription)) fail('Add signup title and description first');
      this.db.prepare('UPDATE LeagueSeasons SET Status = ?, UpdatedAt = ? WHERE SeasonId = ?')
        .run(open ? 'signup_open' : 'signup_closed', now(), seasonId);
      this.audit(open ? 'Signups Opened' : 'Signups Closed',
        `${open ? 'Opened' : 'Closed'} signups for season ${seasonId}`);
      return this.get(seasonId);
    })();
  }

  searchPlayers(search) {
    if (!search) return [];
    const pattern = `%${search.replace(/[!%_]/g, '!$&')}%`;
    return this.db.prepare(`SELECT p.PlayerId, CAST(p.PlayerName AS TEXT) AS PlayerName,
        a.AdjustedMMR FROM PlayerInfo p
      LEFT JOIN AdjustedPlayers a ON a.PlayerId = p.PlayerId
      WHERE CAST(p.PlayerName AS TEXT) LIKE ? ESCAPE '!'
        OR CAST(p.PlayerId AS TEXT) LIKE ? ESCAPE '!'
      ORDER BY p.PlayerName COLLATE NOCASE, p.PlayerId LIMIT 50`).all(pattern, pattern);
  }

  teams(seasonId, includePlayers = false) {
    const rows = this.db.prepare(`SELECT t.TeamSubmissionId, t.SeasonId, t.CaptainId,
        CAST(captain.PlayerName AS TEXT) AS CaptainName,
        t.TeamName, t.IsManual, t.ManualAverageMMR, t.GroupId, t.ExternalTeamId,
        t.SubmittedAt, t.UpdatedAt,
        CASE WHEN t.IsManual = 1 THEN t.ManualAverageMMR ELSE
          (SELECT ROUND(AVG(p.MMR), 2) FROM SeasonTeamPlayers p
            WHERE p.TeamSubmissionId = t.TeamSubmissionId) END AS AverageMMR
      FROM SeasonTeams t LEFT JOIN PlayerInfo captain ON captain.PlayerId = t.CaptainId
      WHERE t.SeasonId = ? ORDER BY t.SubmittedAt, t.TeamSubmissionId`).all(seasonId);
    if (includePlayers) {
      const query = this.db.prepare(`SELECT p.PlayerId, CAST(i.PlayerName AS TEXT) AS PlayerName,
        p.Slot, p.MMR, p.DotaProfileUrl, p.ScreenshotMime,
        1 AS HasScreenshot FROM SeasonTeamPlayers p
        JOIN PlayerInfo i ON i.PlayerId = p.PlayerId
        WHERE p.TeamSubmissionId = ? ORDER BY p.Slot`);
      for (const row of rows) row.players = row.IsManual ? [] : query.all(row.TeamSubmissionId);
    }
    return rows;
  }

  getTeam(teamId, includePlayers = true) {
    const team = this.db.prepare(`SELECT * FROM SeasonTeams WHERE TeamSubmissionId = ?`).get(teamId);
    if (!team) return null;
    if (includePlayers) team.players = this.db.prepare(`SELECT p.PlayerId,
      CAST(i.PlayerName AS TEXT) AS PlayerName, p.Slot, p.MMR, p.DotaProfileUrl,
      p.ScreenshotMime, 1 AS HasScreenshot FROM SeasonTeamPlayers p
      JOIN PlayerInfo i ON i.PlayerId = p.PlayerId
      WHERE p.TeamSubmissionId = ? ORDER BY p.Slot`).all(teamId);
    return team;
  }

  screenshot(teamId, playerId) {
    return this.db.prepare(`SELECT p.ScreenshotMime, p.ScreenshotData
      FROM SeasonTeamPlayers p WHERE p.TeamSubmissionId = ? AND p.PlayerId = ?`)
      .get(teamId, playerId) || null;
  }

  saveTeam(seasonId, captainId, input, admin = false, teamId = null) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (admin ? !['signup_open', 'signup_closed'].includes(season.Status) : season.Status !== 'signup_open') {
        fail('Signups are not open for this change', 409);
      }
      const existing = teamId ? this.getTeam(teamId) : null;
      if (teamId && (!existing || existing.SeasonId !== seasonId || existing.IsManual)) fail('Submission not found', 404);
      const teamName = String(input.teamName || '').trim();
      if (!teamName || teamName.length > 60) fail('Team name must be 1-60 characters');
      if (!Array.isArray(input.players) || input.players.length !== 5) fail('A submission needs exactly five players');
      const ids = new Set();
      const resolved = input.players.map((player, index) => {
        const playerId = Number(player.playerId);
        if (!Number.isSafeInteger(playerId) || playerId <= 0 || ids.has(playerId)) fail('Choose five different valid players');
        ids.add(playerId);
        let record = this.db.prepare('SELECT PlayerId, PlayerName FROM PlayerInfo WHERE PlayerId = ?').get(playerId);
        if (!record) {
          const name = String(player.playerName || '').trim();
          if (!name || name.length > 40) fail('New players need a name of 1-40 characters');
          this.db.prepare('INSERT INTO PlayerInfo (PlayerId, PlayerName) VALUES (?, ?)').run(playerId, name);
          record = { PlayerId: playerId, PlayerName: name };
        }
        const adjusted = this.db.prepare('SELECT AdjustedMMR FROM AdjustedPlayers WHERE PlayerId = ?').get(playerId);
        const oldPlayer = existing?.players.find(item => item.PlayerId === playerId);
        const mmr = admin ? Number(player.mmr) : (adjusted?.AdjustedMMR ?? Number(player.mmr));
        if (!Number.isSafeInteger(mmr) || mmr < 5500) fail('Each player MMR must be greater than 5,500');
        const profileUrl = normalizeProfileUrl(player.dotaProfileUrl);
        const screenshot = player.screenshot
          ? this.decodeScreenshot(player.screenshot)
          : oldPlayer ? this.screenshot(teamId, playerId) : null;
        if (!screenshot) fail('Each player needs an MMR screenshot');
        return { playerId, slot: index, mmr, profileUrl, screenshot, record };
      });
      if (!admin && !ids.has(captainId)) fail('The captain must be one of the five players');
      const timestamp = now();
      if (!existing) {
        teamId = this.db.prepare(`INSERT INTO SeasonTeams
          (SeasonId, CaptainId, TeamName, SubmittedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?)`)
          .run(seasonId, captainId, teamName, timestamp, timestamp).lastInsertRowid;
      } else {
        this.db.prepare(`UPDATE SeasonTeams SET TeamName = ?, UpdatedAt = ?
          WHERE TeamSubmissionId = ?`).run(teamName, timestamp, teamId);
        this.db.prepare('DELETE FROM SeasonTeamPlayers WHERE TeamSubmissionId = ?').run(teamId);
      }
      const insert = this.db.prepare(`INSERT INTO SeasonTeamPlayers
        (TeamSubmissionId, PlayerId, Slot, MMR, DotaProfileUrl, ScreenshotMime, ScreenshotData)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const player of resolved) insert.run(teamId, player.playerId, player.slot, player.mmr,
        player.profileUrl, player.screenshot.ScreenshotMime, player.screenshot.ScreenshotData);
      if (admin) this.audit(existing ? 'Signup Edited' : 'Signup Added',
        `${existing ? 'Edited' : 'Added'} ${teamName} (submission ${teamId}) for season ${seasonId}`);
      return this.getTeam(teamId);
    })();
  }

  decodeScreenshot(value) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value));
    if (!match) fail('Screenshot must be a JPEG, PNG, or WebP image');
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > 2 * 1024 * 1024) fail('Each screenshot must be 2 MB or less');
    const signatures = {
      'image/jpeg': data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
      'image/png': data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'image/webp': data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP',
    };
    if (!signatures[match[1]]) fail('Screenshot contents do not match the image type');
    return { ScreenshotMime: match[1], ScreenshotData: data };
  }

  addManualTeam(seasonId, teamName, averageMMR) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Close signups before adding manual teams', 409);
      const timestamp = now();
      const id = this.db.prepare(`INSERT INTO SeasonTeams
        (SeasonId, TeamName, IsManual, ManualAverageMMR, SubmittedAt, UpdatedAt)
        VALUES (?, ?, 1, ?, ?, ?)`).run(seasonId, teamName, averageMMR, timestamp, timestamp).lastInsertRowid;
      this.audit('Manual Team Added', `Added ${teamName} (submission ${id}) to season ${seasonId}`);
      return this.getTeam(id);
    })();
  }

  updateManualTeam(seasonId, teamId, teamName, averageMMR) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      const team = this.getTeam(teamId, false);
      if (!season || !team || team.SeasonId !== seasonId || !team.IsManual) fail('Manual team not found', 404);
      if (season.Status !== 'signup_closed') fail('Manual teams can only change before the league starts', 409);
      this.db.prepare(`UPDATE SeasonTeams SET TeamName = ?, ManualAverageMMR = ?, UpdatedAt = ?
        WHERE TeamSubmissionId = ?`).run(teamName, averageMMR, now(), teamId);
      this.audit('Manual Team Changed', `Changed manual team ${teamId} in season ${seasonId}`);
      return this.getTeam(teamId);
    })();
  }

  removeTeam(seasonId, teamId) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      const team = this.getTeam(teamId, false);
      if (!season || !team || team.SeasonId !== seasonId) fail('Team not found', 404);
      if (!['signup_open', 'signup_closed'].includes(season.Status)) fail('Teams cannot be removed after league start', 409);
      this.db.prepare('DELETE FROM SeasonTeamPlayers WHERE TeamSubmissionId = ?').run(teamId);
      this.db.prepare('DELETE FROM SeasonTeams WHERE TeamSubmissionId = ?').run(teamId);
      this.audit('Signup Removed', `Removed ${team.TeamName} (submission ${teamId}) from season ${seasonId}`);
      return team;
    })();
  }

  groups(seasonId, teams = this.teams(seasonId)) {
    const groups = this.db.prepare(`SELECT GroupId, GroupName, SortOrder FROM SeasonGroups
      WHERE SeasonId = ? ORDER BY SortOrder, GroupId`).all(seasonId);
    return groups.map(group => {
      const members = teams.filter(team => team.GroupId === group.GroupId);
      return { ...group, teams: members,
        AverageMMR: members.length ? members.reduce((sum, team) => sum + team.AverageMMR, 0) / members.length : null };
    });
  }

  addGroup(seasonId, groupName) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Close signups before building groups', 409);
      const order = this.db.prepare(`SELECT COALESCE(MAX(SortOrder), 0) + 1 AS Value
        FROM SeasonGroups WHERE SeasonId = ?`).get(seasonId).Value;
      const result = this.db.prepare(`INSERT INTO SeasonGroups (SeasonId, GroupName, SortOrder)
        VALUES (?, ?, ?)`).run(seasonId, groupName, order);
      this.audit('Group Added', `Added ${groupName} to season ${seasonId}`);
      return this.db.prepare('SELECT * FROM SeasonGroups WHERE GroupId = ?').get(result.lastInsertRowid);
    })();
  }

  removeGroup(seasonId, groupId) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Groups can only change before league start', 409);
      const group = this.db.prepare('SELECT * FROM SeasonGroups WHERE SeasonId = ? AND GroupId = ?').get(seasonId, groupId);
      if (!group) fail('Group not found', 404);
      this.db.prepare('UPDATE SeasonTeams SET GroupId = NULL WHERE SeasonId = ? AND GroupId = ?').run(seasonId, groupId);
      this.db.prepare('DELETE FROM SeasonGroups WHERE GroupId = ?').run(groupId);
      this.audit('Group Removed', `Removed ${group.GroupName} from season ${seasonId}`);
      return group;
    })();
  }

  renameGroup(seasonId, groupId, groupName) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Groups can only change before league start', 409);
      const group = this.db.prepare('SELECT * FROM SeasonGroups WHERE SeasonId = ? AND GroupId = ?').get(seasonId, groupId);
      if (!group) fail('Group not found', 404);
      this.db.prepare('UPDATE SeasonGroups SET GroupName = ? WHERE GroupId = ?').run(groupName, groupId);
      this.audit('Group Renamed', `Renamed ${group.GroupName} to ${groupName} in season ${seasonId}`);
      return this.db.prepare('SELECT * FROM SeasonGroups WHERE GroupId = ?').get(groupId);
    })();
  }

  assignTeam(seasonId, teamId, groupId) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Assignments can only change before league start', 409);
      const team = this.getTeam(teamId, false);
      if (!team || team.SeasonId !== seasonId) fail('Team not found', 404);
      if (groupId !== null && !this.db.prepare(`SELECT 1 FROM SeasonGroups
        WHERE SeasonId = ? AND GroupId = ?`).get(seasonId, groupId)) fail('Group not found', 404);
      this.db.prepare('UPDATE SeasonTeams SET GroupId = ?, UpdatedAt = ? WHERE TeamSubmissionId = ?')
        .run(groupId, now(), teamId);
      this.audit('Group Assignment Changed', `Moved ${team.TeamName} (submission ${teamId}) to group ${groupId ?? 'none'}`);
      return this.getTeam(teamId, false);
    })();
  }

  randomize(seasonId, random = Math.random) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Close signups before randomizing', 409);
      const groups = this.groups(seasonId);
      const teams = this.teams(seasonId);
      if (!groups.length || teams.length < groups.length) {
        fail('Create groups and have at least one team for each group', 409);
      }
      const choice = randomizeGroups(teams, groups.length, random);
      const update = this.db.prepare('UPDATE SeasonTeams SET GroupId = ?, UpdatedAt = ? WHERE TeamSubmissionId = ?');
      choice.groups.forEach((members, index) => members.forEach(team =>
        update.run(groups[index].GroupId, now(), team.TeamSubmissionId)));
      return { groups: this.groups(seasonId), spread: choice.spread };
    })();
  }

  groupSummary(seasonId, teams) {
    const groups = this.groups(seasonId, teams);
    return { groups, spread: groups.length && groups.every(group => group.teams.length)
      ? groupSpread(groups.map(group => group.teams)) : null };
  }

  getRules(seasonId) {
    return this.db.prepare('SELECT * FROM SeasonLeagueRules WHERE SeasonId = ?').get(seasonId)
      || { SeasonId: seasonId, ...DEFAULT_LEAGUE_RULES };
  }

  saveRules(seasonId, values) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status === 'active' || season.Status === 'ended') fail('Use league settings after the league starts', 409);
      const rules = normalizeLeagueRules(values);
      this.db.prepare(`INSERT INTO SeasonLeagueRules
        (SeasonId, UpperBracketTeams, LowerBracketTeams, EliminatedTeams, HasTiebreaker, TiebreakerPosition)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(SeasonId) DO UPDATE SET
          UpperBracketTeams = excluded.UpperBracketTeams,
          LowerBracketTeams = excluded.LowerBracketTeams,
          EliminatedTeams = excluded.EliminatedTeams,
          HasTiebreaker = excluded.HasTiebreaker,
          TiebreakerPosition = excluded.TiebreakerPosition`).run(seasonId,
            rules.UpperBracketTeams, rules.LowerBracketTeams, rules.EliminatedTeams,
            rules.HasTiebreaker ? 1 : 0, rules.TiebreakerPosition);
      this.audit('League Rules Changed', `Updated draft league rules for season ${seasonId}`);
      return this.getRules(seasonId);
    })();
  }

  start(seasonId, externalLeagueId = null) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'signup_closed') fail('Close signups before starting the league', 409);
      externalLeagueId ??= season.ExternalLeagueId;
      if (!Number.isSafeInteger(externalLeagueId) || externalLeagueId <= 0) fail('Enter a valid external League ID');
      if (this.db.prepare('SELECT 1 FROM LeagueInfo WHERE Active = 1').get()) fail('A league is already active', 409);
      if (this.db.prepare('SELECT 1 FROM LeagueInfo WHERE LeagueId = ?').get(externalLeagueId)) fail('League ID already exists', 409);
      if (this.db.prepare('SELECT 1 FROM LeagueSeasons WHERE ExternalLeagueId = ? AND SeasonId != ?')
        .get(externalLeagueId, seasonId)) fail('League ID already exists', 409);
      const groups = this.groups(seasonId);
      const teams = this.teams(seasonId, true);
      if (!groups.length || !teams.length || teams.some(team => !team.GroupId)) fail('Assign every team to a group first', 409);
      const sizes = groups.map(group => group.teams.length);
      if (Math.max(...sizes) - Math.min(...sizes) > 1) fail('Group sizes may differ by at most one team', 409);
      this.db.prepare('INSERT INTO LeagueInfo (LeagueId, LeagueName, Active) VALUES (?, ?, 1)')
        .run(externalLeagueId, season.LeagueName);
      const addGroup = this.db.prepare('INSERT INTO GroupNames (LeagueId, GroupId, GroupName) VALUES (?, ?, ?)');
      const addRoster = this.db.prepare(`INSERT INTO LeagueRosterEntries
        (LeagueId, GroupId, DisplayName, SortOrder, TeamSubmissionId) VALUES (?, ?, ?, ?, ?)`);
      groups.forEach((group, groupIndex) => {
        addGroup.run(externalLeagueId, groupIndex + 1, group.GroupName);
        group.teams.forEach((team, teamIndex) => addRoster.run(externalLeagueId, groupIndex + 1,
          team.TeamName, teamIndex + 1, team.TeamSubmissionId));
      });
      const snapshot = this.db.prepare(`INSERT INTO SignupMMRs
        (SeasonId, TeamSubmissionId, PlayerId, SignupMMR) VALUES (?, ?, ?, ?)`);
      for (const team of teams) if (!team.IsManual) {
        for (const player of team.players) snapshot.run(seasonId, team.TeamSubmissionId, player.PlayerId, player.MMR);
      }
      const rules = this.getRules(seasonId);
      this.db.prepare(`INSERT INTO LeagueRules
        (LeagueId, UpperBracketTeams, LowerBracketTeams, EliminatedTeams, HasTiebreaker, TiebreakerPosition)
        VALUES (?, ?, ?, ?, ?, ?)`).run(externalLeagueId, rules.UpperBracketTeams,
          rules.LowerBracketTeams, rules.EliminatedTeams, rules.HasTiebreaker ? 1 : 0,
          rules.TiebreakerPosition);
      this.db.prepare(`UPDATE LeagueSeasons SET Status = 'active', ExternalLeagueId = ?, UpdatedAt = ?
        WHERE SeasonId = ?`).run(externalLeagueId, now(), seasonId);
      this.audit('League Started', `Started ${season.LeagueName} (season ${seasonId}, league ${externalLeagueId})`);
      return this.get(seasonId);
    })();
  }

  end(seasonId, championTeamId) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'active') fail('League is not active', 409);
      if (!this.db.prepare(`SELECT 1 FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
        WHERE ml.LeagueId = ? AND (mt.TeamRad = ? OR mt.TeamDire = ?) LIMIT 1`)
        .get(season.ExternalLeagueId, championTeamId, championTeamId)) fail('Champion must be a team that played in this league', 409);
      this.db.prepare('UPDATE LeagueInfo SET Active = 0 WHERE LeagueId = ?').run(season.ExternalLeagueId);
      const timestamp = now();
      this.db.prepare(`UPDATE LeagueSeasons SET Status = 'ended', ChampionTeamId = ?,
        EndedAt = ?, UpdatedAt = ? WHERE SeasonId = ?`)
        .run(championTeamId, timestamp, timestamp, seasonId);
      this.audit('League Ended', `Ended season ${seasonId}; champion team ${championTeamId}`);
      return this.get(seasonId);
    })();
  }

  correctChampion(seasonId, championTeamId) {
    return this.db.transaction(() => {
      const season = this.get(seasonId);
      if (!season) fail('Season not found', 404);
      if (season.Status !== 'ended') fail('Only ended seasons have a champion', 409);
      if (!this.db.prepare(`SELECT 1 FROM MatchTeam mt JOIN MatchLeague ml ON ml.MatchId = mt.MatchId
        WHERE ml.LeagueId = ? AND (mt.TeamRad = ? OR mt.TeamDire = ?) LIMIT 1`)
        .get(season.ExternalLeagueId, championTeamId, championTeamId)) fail('Team did not play in this league', 409);
      this.db.prepare('UPDATE LeagueSeasons SET ChampionTeamId = ?, UpdatedAt = ? WHERE SeasonId = ?')
        .run(championTeamId, now(), seasonId);
      this.audit('Champion Corrected', `Changed season ${seasonId} champion from ${season.ChampionTeamId} to ${championTeamId}`);
      return this.get(seasonId);
    })();
  }

  championTeams(seasonId) {
    const season = this.get(seasonId);
    if (!season?.ExternalLeagueId) return [];
    return this.db.prepare(`SELECT ids.TeamId,
      COALESCE(ln.DisplayName, ti.TeamName, 'Team ' || ids.TeamId) AS TeamName
      FROM (
        SELECT mt.TeamRad AS TeamId FROM MatchTeam mt
          JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
        UNION
        SELECT mt.TeamDire AS TeamId FROM MatchTeam mt
          JOIN MatchLeague ml ON ml.MatchId = mt.MatchId WHERE ml.LeagueId = ?
      ) ids
      LEFT JOIN TeamInfo ti ON ti.TeamId = ids.TeamId
      LEFT JOIN LeagueTeamNames ln ON ln.LeagueId = ? AND ln.TeamId = ids.TeamId
      WHERE ids.TeamId > 0 ORDER BY TeamName`).all(season.ExternalLeagueId,
        season.ExternalLeagueId, season.ExternalLeagueId);
  }

  championFeature(season) {
    if (!season?.ChampionTeamId || !season.ExternalLeagueId) return null;
    const name = this.db.prepare(`SELECT COALESCE(ln.DisplayName, ti.TeamName) AS TeamName
      FROM TeamInfo ti LEFT JOIN LeagueTeamNames ln
        ON ln.LeagueId = ? AND ln.TeamId = ti.TeamId WHERE ti.TeamId = ?`)
      .get(season.ExternalLeagueId, season.ChampionTeamId)?.TeamName;
    const boundary = this.db.prepare(`SELECT GroupEndMatchId, TieBreakerEndMatchId
      FROM LeagueStageBoundaries WHERE LeagueId = ?`).get(season.ExternalLeagueId);
    const games = this.db.prepare(`SELECT ml.MatchId, mt.WinnerId FROM MatchLeague ml
      JOIN MatchTeam mt ON mt.MatchId = ml.MatchId
      WHERE ml.LeagueId = ? AND (mt.TeamRad = ? OR mt.TeamDire = ?)
        AND mt.WinnerId IN (mt.TeamRad, mt.TeamDire)`)
      .all(season.ExternalLeagueId, season.ChampionTeamId, season.ChampionTeamId);
    const record = rows => ({ wins: rows.filter(game => game.WinnerId === season.ChampionTeamId).length,
      losses: rows.filter(game => game.WinnerId !== season.ChampionTeamId).length });
    const groupGames = boundary?.GroupEndMatchId
      ? games.filter(game => game.MatchId <= boundary.GroupEndMatchId) : [];
    const playoffStart = boundary?.TieBreakerEndMatchId ?? boundary?.GroupEndMatchId;
    const playoffGames = playoffStart ? games.filter(game => game.MatchId > playoffStart) : [];
    const series = this.db.prepare(`SELECT si.SeriesId,
        SUM(CASE WHEN mt.WinnerId = ? THEN 1 ELSE 0 END) AS Wins,
        SUM(CASE WHEN mt.WinnerId <> ? AND mt.WinnerId IN (mt.TeamRad, mt.TeamDire) THEN 1 ELSE 0 END) AS Losses
      FROM SeriesInfo si JOIN SeriesMatch sm ON sm.SeriesId = si.SeriesId
      JOIN MatchLeague ml ON ml.MatchId = sm.MatchId
      JOIN MatchTeam mt ON mt.MatchId = sm.MatchId
      WHERE ml.LeagueId = ? AND (si.Team1 = ? OR si.Team2 = ?) AND sm.MatchId > ?
      GROUP BY si.SeriesId`).all(season.ChampionTeamId, season.ChampionTeamId,
        season.ExternalLeagueId, season.ChampionTeamId, season.ChampionTeamId, playoffStart ?? Number.MAX_SAFE_INTEGER);
    const players = this.championPlayers(season, boundary);
    return { seasonId: season.SeasonId, leagueId: season.ExternalLeagueId,
      leagueName: season.LeagueName, teamId: season.ChampionTeamId,
      teamName: name || `Team ${season.ChampionTeamId}`,
      players,
      groupGames: groupGames.length ? record(groupGames) : null,
      playoffGames: playoffGames.length ? record(playoffGames) : null,
      playoffSeries: series.length ? {
        wins: series.filter(item => item.Wins > item.Losses).length,
        losses: series.filter(item => item.Losses > item.Wins).length,
      } : null };
  }

  championPlayers(season, boundary) {
    const teamId = season.ChampionTeamId;
    const teamGames = this.db.prepare(`SELECT COUNT(*) AS Games
      FROM MatchLeague ml JOIN MatchTeam mt ON mt.MatchId = ml.MatchId
      WHERE ml.LeagueId = ? AND (mt.TeamRad = ? OR mt.TeamDire = ?)`)
      .get(season.ExternalLeagueId, teamId, teamId).Games;
    const rows = this.db.prepare(`SELECT DISTINCT mtp.PlayerId,
        COALESCE(pi.PlayerName, 'Player ' || mtp.PlayerId) AS PlayerName,
        mp.MatchId, mp.HeroId, COALESCE(hi.HeroName, 'Hero ' || mp.HeroId) AS HeroName,
        mp.Kills, mp.Deaths, mp.Assists, mp.Healing, mp.TowerDamage,
        mp.GPM, mp.Lasthits, mp.HeroDamage, mt.WinnerId,
        CASE WHEN mt.TeamRad = ? THEN mt.TeamDire ELSE mt.TeamRad END AS OpponentId,
        COALESCE(ln.DisplayName, opponent.TeamName) AS OpponentName
      FROM MatchTeamPlayer mtp
      JOIN MatchPlayer mp ON mp.MatchId = mtp.MatchId AND mp.PlayerId = mtp.PlayerId
      JOIN MatchLeague ml ON ml.MatchId = mp.MatchId
      JOIN MatchTeam mt ON mt.MatchId = mp.MatchId
      LEFT JOIN PlayerInfo pi ON pi.PlayerId = mtp.PlayerId
      LEFT JOIN HeroInfo hi ON hi.HeroId = mp.HeroId
      LEFT JOIN TeamInfo opponent ON opponent.TeamId =
        CASE WHEN mt.TeamRad = ? THEN mt.TeamDire ELSE mt.TeamRad END
      LEFT JOIN LeagueTeamNames ln ON ln.LeagueId = ml.LeagueId AND ln.TeamId = opponent.TeamId
      WHERE mtp.TeamId = ? AND ml.LeagueId = ? AND (mt.TeamRad = ? OR mt.TeamDire = ?)
      ORDER BY mp.MatchId`).all(teamId, teamId, teamId, season.ExternalLeagueId, teamId, teamId);
    const players = new Map();
    const stageFor = matchId => {
      if (!boundary?.GroupEndMatchId) return 'League match';
      if (matchId <= boundary.GroupEndMatchId) return 'Group stage';
      if (boundary.TieBreakerEndMatchId != null && matchId <= boundary.TieBreakerEndMatchId) {
        return 'Tiebreakers';
      }
      return 'Playoffs';
    };
    for (const row of rows) {
      let player = players.get(row.PlayerId);
      if (!player) {
        player = { playerId: row.PlayerId, playerName: row.PlayerName,
          games: 0, wins: 0, playoffWins: 0, heroes: new Map(), bestMatches: {} };
        players.set(row.PlayerId, player);
      }
      const won = row.WinnerId === teamId;
      player.games++;
      if (won) player.wins++;
      if (won && stageFor(row.MatchId) === 'Playoffs') player.playoffWins++;
      const hero = player.heroes.get(row.HeroId) || { heroId: row.HeroId,
        heroName: row.HeroName, games: 0, wins: 0 };
      hero.games++;
      if (won) hero.wins++;
      player.heroes.set(row.HeroId, hero);
      for (const [key, value] of Object.entries({ healing: row.Healing,
        towerDamage: row.TowerDamage, gpm: row.GPM, lastHits: row.Lasthits,
        heroDamage: row.HeroDamage })) {
        if (!Number.isFinite(Number(value)) || Number(value) <= 0) continue;
        if (Number(value) > (player.bestMatches[key]?.value ?? 0)) {
          player.bestMatches[key] = { value: Number(value), matchId: row.MatchId,
            stage: stageFor(row.MatchId), opponentName: row.OpponentName || `Team ${row.OpponentId}` };
        }
      }
    }
    const regularPlayers = [...players.values()].filter(player => player.games * 2 > teamGames)
      .sort((a, b) => b.games - a.games || b.wins - a.wins ||
        a.playerName.localeCompare(b.playerName));
    assignChampionSpotlights(regularPlayers);
    return regularPlayers.map(({ heroes, bestMatches, ...player }) => ({ ...player,
      signatureHero: [...heroes.values()].sort((a, b) =>
        b.games - a.games || b.wins - a.wins || a.heroName.localeCompare(b.heroName))[0] || null,
    }));
  }

  publicHome() {
    const current = this.current();
    const completed = this.lastEnded();
    return { activeLeagueId: current?.Status === 'active' ? current.ExternalLeagueId : null,
      signup: current?.Status === 'signup_open' ? {
        seasonId: current.SeasonId, title: current.SignupTitle,
        description: current.SignupDescription,
      } : null,
      champion: this.championFeature(completed) };
  }
}
