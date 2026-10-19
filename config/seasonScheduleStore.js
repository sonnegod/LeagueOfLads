function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function integer(value, label, max) {
  const raw = String(value ?? '');
  const number = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(number) || number < 1 || number > max) {
    fail(`Enter a valid ${label} (1-${max})`);
  }
  return number;
}

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Each round contains at most one series per team. null represents an odd-team bye.
export function groupRoundRobin(teamIds, random = Math.random) {
  if (teamIds.length < 2) return [];
  const rotation = shuffle(teamIds, random);
  if (rotation.length % 2) rotation.push(null);
  const rounds = [];
  for (let round = 0; round < rotation.length - 1; round++) {
    const pairs = [];
    for (let i = 0; i < rotation.length / 2; i++) {
      const a = rotation[i], b = rotation[rotation.length - 1 - i];
      if (a !== null && b !== null) pairs.push([Math.min(a, b), Math.max(a, b)]);
    }
    rounds.push(pairs);
    rotation.splice(1, 0, rotation.pop());
  }
  return shuffle(rounds, random);
}

export default class SeasonScheduleStore {
  constructor(db, audit = () => {}) {
    this.db = db;
    this.audit = audit;
    db.exec(`
      CREATE TABLE IF NOT EXISTS SeasonScheduleSettings (
        SeasonId INTEGER PRIMARY KEY REFERENCES LeagueSeasons(SeasonId),
        StartDate TEXT NOT NULL,
        SeriesPerWindow INTEGER NOT NULL CHECK (SeriesPerWindow BETWEEN 1 AND 20),
        WeeksPerWindow INTEGER NOT NULL CHECK (WeeksPerWindow BETWEEN 1 AND 12),
        UpdatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS SeasonMatchups (
        MatchupId INTEGER PRIMARY KEY AUTOINCREMENT,
        SeasonId INTEGER NOT NULL REFERENCES LeagueSeasons(SeasonId),
        GroupId INTEGER NOT NULL,
        TeamAEntryId INTEGER NOT NULL REFERENCES LeagueRosterEntries(EntryId),
        TeamBEntryId INTEGER NOT NULL REFERENCES LeagueRosterEntries(EntryId),
        WindowNumber INTEGER NOT NULL CHECK (WindowNumber BETWEEN 1 AND 104),
        CHECK (TeamAEntryId < TeamBEntryId),
        UNIQUE (SeasonId, TeamAEntryId, TeamBEntryId)
      );
      CREATE INDEX IF NOT EXISTS idx_SeasonMatchups_Window
        ON SeasonMatchups (SeasonId, WindowNumber, GroupId);
    `);
  }

  season(seasonId, editing = false) {
    const season = this.db.prepare('SELECT * FROM LeagueSeasons WHERE SeasonId = ?').get(seasonId);
    if (!season) fail('Season not found', 404);
    if (editing && season.Status !== 'active') fail('Matchups can be planned once the league starts', 409);
    return season;
  }

  settings(seasonId) {
    return this.db.prepare('SELECT * FROM SeasonScheduleSettings WHERE SeasonId = ?').get(seasonId) || null;
  }

  teams(seasonId) {
    const season = this.season(seasonId);
    return this.db.prepare(`SELECT r.EntryId, r.GroupId, r.TeamId, r.DisplayName AS TeamName
      FROM LeagueRosterEntries r WHERE r.LeagueId = ? ORDER BY r.SortOrder, r.EntryId`)
      .all(season.ExternalLeagueId);
  }

  read(seasonId) {
    const season = this.season(seasonId);
    const settings = this.settings(seasonId);
    const teams = this.teams(seasonId);
    const groups = this.db.prepare(`SELECT GroupId, GroupName FROM GroupNames
      WHERE LeagueId = ? ORDER BY GroupId`).all(season.ExternalLeagueId);
    const matchups = this.db.prepare(`SELECT m.*, a.DisplayName AS TeamAName, b.DisplayName AS TeamBName,
      a.TeamId AS TeamAId, b.TeamId AS TeamBId
      FROM SeasonMatchups m
      JOIN LeagueRosterEntries a ON a.EntryId = m.TeamAEntryId
      JOIN LeagueRosterEntries b ON b.EntryId = m.TeamBEntryId
      WHERE m.SeasonId = ? ORDER BY m.WindowNumber, m.GroupId, m.MatchupId`).all(seasonId);
    const windows = [];
    const warnings = [];
    const lastWindow = Math.max(0, ...matchups.map(row => row.WindowNumber));
    if (settings) for (let number = 1; number <= lastWindow; number++) {
      const startDate = shiftDate(settings.StartDate, (number - 1) * settings.WeeksPerWindow * 7);
      const endDate = shiftDate(startDate, settings.WeeksPerWindow * 7 - 1);
      const counts = new Map(teams.map(team => [team.EntryId, 0]));
      for (const matchup of matchups.filter(row => row.WindowNumber === number)) {
        for (const entryId of [matchup.TeamAEntryId, matchup.TeamBEntryId]) {
          counts.set(entryId, (counts.get(entryId) || 0) + 1);
        }
      }
      windows.push({ number, startDate, endDate,
        teamLoads: teams.map(team => ({ ...team, series: counts.get(team.EntryId) || 0 })) });
      for (const team of teams) if (counts.get(team.EntryId) > settings.SeriesPerWindow) {
        warnings.push(`${team.TeamName} has ${counts.get(team.EntryId)} series in window ${number} (target ${settings.SeriesPerWindow}).`);
      }
    }
    const teamMap = new Map(teams.map(team => [team.EntryId, team]));
    for (const row of matchups) {
      if (teamMap.get(row.TeamAEntryId)?.GroupId !== row.GroupId
        || teamMap.get(row.TeamBEntryId)?.GroupId !== row.GroupId) {
        warnings.push(`${row.TeamAName} vs ${row.TeamBName}: group assignments have changed; update this suggestion.`);
      }
    }
    const expectedMatchups = groups.reduce((sum, group) => {
      const n = teams.filter(team => team.GroupId === group.GroupId).length;
      return sum + n * (n - 1) / 2;
    }, 0);
    return { season: { SeasonId: season.SeasonId, LeagueName: season.LeagueName,
      Status: season.Status, ExternalLeagueId: season.ExternalLeagueId },
    settings, teams, groups, matchups, windows, warnings, expectedMatchups };
  }

  forLeague(leagueId) {
    const season = this.db.prepare('SELECT SeasonId FROM LeagueSeasons WHERE ExternalLeagueId = ?').get(leagueId);
    return season ? this.read(season.SeasonId)
      : { settings: null, matchups: [], windows: [], groups: [], teams: [], warnings: [], expectedMatchups: 0 };
  }

  saveSettings(seasonId, values = {}) {
    return this.db.transaction(() => {
      this.season(seasonId, true);
      const start = values.startDate;
      if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start)
        || !Number.isFinite(Date.parse(`${start}T00:00:00Z`))
        || new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10) !== start
        || start < '2000-01-01' || start > '2100-12-31') fail('Enter a valid schedule start date');
      const series = integer(values.seriesPerWindow, 'series target per team', 20);
      const weeks = integer(values.weeksPerWindow, 'weeks per window', 12);
      this.db.prepare(`INSERT INTO SeasonScheduleSettings VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (SeasonId) DO UPDATE SET StartDate = excluded.StartDate,
        SeriesPerWindow = excluded.SeriesPerWindow, WeeksPerWindow = excluded.WeeksPerWindow,
        UpdatedAt = excluded.UpdatedAt`).run(seasonId, start, series, weeks, new Date().toISOString());
      this.audit('Schedule Settings Changed', `Season ${seasonId}: ${series} suggested series every ${weeks} weeks, starting ${start}`);
      return this.read(seasonId);
    })();
  }

  requireSettings(seasonId) {
    this.season(seasonId, true);
    const settings = this.settings(seasonId);
    if (!settings) fail('Save the schedule start date and pace first', 409);
    return settings;
  }

  insert(seasonId, groupId, a, b, window) {
    this.db.prepare(`INSERT INTO SeasonMatchups
      (SeasonId, GroupId, TeamAEntryId, TeamBEntryId, WindowNumber) VALUES (?, ?, ?, ?, ?)`)
      .run(seasonId, groupId, Math.min(a, b), Math.max(a, b), window);
  }

  generate(seasonId, { replaceExisting = false } = {}, random = Math.random) {
    return this.db.transaction(() => {
      const settings = this.requireSettings(seasonId);
      const { teams, groups } = this.read(seasonId);
      if (teams.some(team => !groups.some(group => group.GroupId === team.GroupId))) {
        fail('Assign every team to a group first', 409);
      }
      if (!groups.some(group => teams.filter(team => team.GroupId === group.GroupId).length >= 2)) {
        fail('At least one group needs two teams to generate matchups', 409);
      }
      if (this.db.prepare('SELECT 1 FROM SeasonMatchups WHERE SeasonId = ?').get(seasonId) && replaceExisting !== true) {
        fail('A plan already exists. Confirm replacement to randomize it again.', 409);
      }
      this.db.prepare('DELETE FROM SeasonMatchups WHERE SeasonId = ?').run(seasonId);
      for (const group of groups) {
        const rounds = groupRoundRobin(teams.filter(team => team.GroupId === group.GroupId).map(team => team.EntryId), random);
        rounds.forEach((pairs, index) => {
          const window = Math.floor(index / settings.SeriesPerWindow) + 1;
          pairs.forEach(([a, b]) => this.insert(seasonId, group.GroupId, a, b, window));
        });
      }
      this.audit('Schedule Randomized', `Generated in-group round robin for season ${seasonId}`);
      return this.read(seasonId);
    })();
  }

  saveMatchup(seasonId, values = {}, matchupId = null) {
    return this.db.transaction(() => {
      this.requireSettings(seasonId);
      const window = integer(values.windowNumber, 'window number', 104);
      const a = integer(values.teamAEntryId, 'first team', Number.MAX_SAFE_INTEGER);
      const b = integer(values.teamBEntryId, 'second team', Number.MAX_SAFE_INTEGER);
      if (a === b) fail('Choose two different teams');
      const teams = this.teams(seasonId);
      const teamA = teams.find(team => team.EntryId === a), teamB = teams.find(team => team.EntryId === b);
      if (!teamA || !teamB) fail('Both teams must belong to this league');
      const group = this.db.prepare('SELECT 1 FROM GroupNames WHERE LeagueId = ? AND GroupId = ?')
        .get(this.season(seasonId).ExternalLeagueId, teamA.GroupId);
      if (!group || teamA.GroupId !== teamB.GroupId) fail('Choose opponents from the same group');
      if (matchupId !== null && !this.db.prepare('SELECT 1 FROM SeasonMatchups WHERE SeasonId = ? AND MatchupId = ?')
        .get(seasonId, matchupId)) fail('Matchup not found', 404);
      const low = Math.min(a, b), high = Math.max(a, b);
      const duplicate = this.db.prepare(`SELECT 1 FROM SeasonMatchups
        WHERE SeasonId = ? AND TeamAEntryId = ? AND TeamBEntryId = ? AND MatchupId <> ?`)
        .get(seasonId, low, high, matchupId ?? -1);
      if (duplicate) fail('These teams already have a suggested matchup', 409);
      if (matchupId === null) this.insert(seasonId, teamA.GroupId, low, high, window);
      else this.db.prepare(`UPDATE SeasonMatchups SET GroupId = ?, TeamAEntryId = ?, TeamBEntryId = ?, WindowNumber = ?
        WHERE SeasonId = ? AND MatchupId = ?`).run(teamA.GroupId, low, high, window, seasonId, matchupId);
      this.audit('Schedule Matchup Changed', `Season ${seasonId}: ${teamA.TeamName} vs ${teamB.TeamName}, window ${window}`);
      return this.read(seasonId);
    })();
  }

  randomMatchup(seasonId, values = {}, random = Math.random) {
    return this.db.transaction(() => {
      this.requireSettings(seasonId);
      const window = integer(values.windowNumber, 'window number', 104);
      const groupId = integer(values.groupId, 'group', Number.MAX_SAFE_INTEGER);
      const fixed = values.teamAEntryId ? integer(values.teamAEntryId, 'first team', Number.MAX_SAFE_INTEGER) : null;
      const plan = this.read(seasonId);
      const teams = plan.teams.filter(team => team.GroupId === groupId);
      const existing = new Set(plan.matchups.map(row => `${row.TeamAEntryId}:${row.TeamBEntryId}`));
      const loads = new Map();
      for (const row of plan.matchups.filter(row => row.WindowNumber === window)) {
        for (const entryId of [row.TeamAEntryId, row.TeamBEntryId]) loads.set(entryId, (loads.get(entryId) || 0) + 1);
      }
      const candidates = [];
      for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
        const [a, b] = [teams[i].EntryId, teams[j].EntryId].sort((x, y) => x - y);
        if ((!fixed || a === fixed || b === fixed) && !existing.has(`${a}:${b}`)) {
          candidates.push({ a, b, load: (loads.get(a) || 0) + (loads.get(b) || 0) });
        }
      }
      if (!candidates.length) fail('No unscheduled opponents are available in this group', 409);
      const lowestLoad = Math.min(...candidates.map(pair => pair.load));
      const options = candidates.filter(pair => pair.load === lowestLoad);
      const pair = options[Math.floor(random() * options.length)];
      return this.saveMatchup(seasonId, { windowNumber: window, teamAEntryId: pair.a, teamBEntryId: pair.b });
    })();
  }

  remove(seasonId, matchupId) {
    return this.db.transaction(() => {
      this.season(seasonId, true);
      const result = this.db.prepare('DELETE FROM SeasonMatchups WHERE SeasonId = ? AND MatchupId = ?')
        .run(seasonId, matchupId);
      if (!result.changes) fail('Matchup not found', 404);
      this.audit('Schedule Matchup Removed', `Removed suggestion ${matchupId} from season ${seasonId}`);
      return this.read(seasonId);
    })();
  }
}
