import express from 'express';
import db from '../database.js';
import { submissionsCsv } from '../config/submissionsCsv.js';

export const publicSeasonRoutes = express.Router();
export const adminSeasonRoutes = express.Router();

const steamBase = 76561197960265728n;

function id(value) {
  const raw = String(value ?? '').trim();
  const number = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function text(value, max) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result && result.length <= max ? result : null;
}

function actorId(req) {
  if (!req.isAuthenticated?.() || !req.user) return null;
  try {
    const result = BigInt(req.user.id) - steamBase;
    return result > 0n && result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
  } catch { return null; }
}

function respond(res, error) {
  if (error.status) return res.status(error.status).json({ error: error.message });
  if (error.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'This value is already in use' });
  console.error('Season request failed:', error);
  return res.status(500).json({ error: 'Season request failed' });
}

publicSeasonRoutes.get('/seasonHome', (req, res) => {
  try { return res.json(db.seasons.publicHome()); }
  catch (error) { return respond(res, error); }
});

publicSeasonRoutes.get('/signup/players', (req, res) => {
  const search = req.query.search ?? '';
  if (typeof search !== 'string' || search.length > 120) return res.status(400).json({ error: 'Invalid search' });
  try {
    if (db.seasons.current()?.Status !== 'signup_open') return res.json({ players: [] });
    return res.json({ players: db.seasons.searchPlayers(search.trim()) });
  } catch (error) { return respond(res, error); }
});

publicSeasonRoutes.get('/signup/:seasonId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  try {
    const season = db.seasons.get(seasonId);
    if (!season || season.Status !== 'signup_open') return res.status(404).json({ error: 'Signups are closed' });
    return res.json({ season: { SeasonId: season.SeasonId, LeagueName: season.LeagueName,
      SignupTitle: season.SignupTitle, SignupDescription: season.SignupDescription } });
  } catch (error) { return respond(res, error); }
});

publicSeasonRoutes.post('/signup/:seasonId/teams', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const captainId = actorId(req);
  if (!captainId) return res.status(401).json({ error: 'Sign in with Steam to submit a team' });
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  try {
    const team = db.seasons.saveTeam(seasonId, captainId, req.body || {});
    return res.status(201).json({ teamSubmissionId: team.TeamSubmissionId });
  } catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/current', (req, res) => {
  try {
    const season = db.seasons.current();
    const latest = db.seasons.lastEnded();
    const showSubmissions = ['signup_open', 'signup_closed'].includes(season?.Status);
    return res.json({ season, latest, teams: showSubmissions ? db.seasons.teams(season.SeasonId, true) : [],
      ...(season ? db.seasons.groupSummary(season.SeasonId) : { groups: [], spread: null }) });
  } catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/current/groupBoard', (req, res) => {
  try {
    const season = db.seasons.current();
    res.set('Cache-Control', 'no-store');
    if (!season) return res.json({ season: null, teams: [], groups: [], spread: null });
    if (season.Status !== 'signup_closed') {
      return res.json({ season: { SeasonId: season.SeasonId, Status: season.Status },
        teams: [], groups: [], spread: null });
    }
    const teams = db.seasons.teams(season.SeasonId);
    return res.json({ season: { SeasonId: season.SeasonId, Status: season.Status }, teams,
      ...db.seasons.groupSummary(season.SeasonId, teams) });
  } catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/:seasonId/submissions.csv', (req, res) => {
  const seasonId = id(req.params.seasonId);
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  try {
    const season = db.seasons.current();
    if (season?.SeasonId !== seasonId || !['signup_open', 'signup_closed'].includes(season.Status)) {
      return res.status(404).json({ error: 'Submissions are unavailable' });
    }
    res.set('Cache-Control', 'no-store');
    res.attachment(`season-${seasonId}-submissions.csv`);
    return res.send(submissionsCsv(db.seasons.teams(seasonId, true)));
  } catch (error) { return respond(res, error); }
});

adminSeasonRoutes.post('/', (req, res) => {
  const name = text(req.body?.leagueName, 60);
  const rawLeagueId = req.body?.leagueId;
  const leagueId = rawLeagueId === undefined || rawLeagueId === null || rawLeagueId === ''
    ? null : id(rawLeagueId);
  if (!name) return res.status(400).json({ error: 'League name must be 1-60 characters' });
  if (leagueId === null && rawLeagueId !== undefined && rawLeagueId !== null && rawLeagueId !== '') {
    return res.status(400).json({ error: 'Enter a valid external League ID' });
  }
  try { return res.status(201).json({ season: db.seasons.create(name, leagueId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.put('/:seasonId/signup', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const title = text(req.body?.title, 120);
  const description = text(req.body?.description, 1000);
  if (!seasonId || !title || !description) return res.status(400).json({ error: 'Add a title and description' });
  try { return res.json({ season: db.seasons.saveSignup(seasonId, title, description) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/:seasonId/signupPreview', (req, res) => {
  const seasonId = id(req.params.seasonId);
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  const season = db.seasons.get(seasonId);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  return res.json({ season: { SeasonId: season.SeasonId, LeagueName: season.LeagueName,
    SignupTitle: season.SignupTitle || season.LeagueName,
    SignupDescription: season.SignupDescription || '' } });
});

for (const [action, open] of [['open', true], ['close', false]]) {
  adminSeasonRoutes.post(`/:seasonId/signup/${action}`, (req, res) => {
    const seasonId = id(req.params.seasonId);
    if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
    try { return res.json({ season: db.seasons.setSignupStatus(seasonId, open) }); }
    catch (error) { return respond(res, error); }
  });
}

adminSeasonRoutes.patch('/:seasonId/teams/:teamId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const teamId = id(req.params.teamId);
  if (!seasonId || !teamId) return res.status(400).json({ error: 'Invalid submission' });
  try { return res.json({ team: db.seasons.saveTeam(seasonId, null, req.body || {}, true, teamId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.post('/:seasonId/manualTeams', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const teamName = text(req.body?.teamName, 60);
  const average = id(req.body?.averageMMR);
  if (!seasonId || !teamName || !average) return res.status(400).json({ error: 'Enter a team name and positive average MMR' });
  try { return res.status(201).json({ team: db.seasons.addManualTeam(seasonId, teamName, average) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.patch('/:seasonId/manualTeams/:teamId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const teamId = id(req.params.teamId);
  const teamName = text(req.body?.teamName, 60);
  const average = id(req.body?.averageMMR);
  if (!seasonId || !teamId || !teamName || !average) return res.status(400).json({ error: 'Invalid manual team' });
  try { return res.json({ team: db.seasons.updateManualTeam(seasonId, teamId, teamName, average) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.delete('/:seasonId/teams/:teamId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const teamId = id(req.params.teamId);
  if (!seasonId || !teamId) return res.status(400).json({ error: 'Invalid submission' });
  try { return res.json({ team: db.seasons.removeTeam(seasonId, teamId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/:seasonId/teams/:teamId/screenshots/:playerId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const teamId = id(req.params.teamId);
  const playerId = id(req.params.playerId);
  if (!seasonId || !teamId || !playerId) return res.status(400).json({ error: 'Invalid screenshot' });
  try {
    const season = db.seasons.get(seasonId);
    if (!['signup_open', 'signup_closed'].includes(season?.Status)) {
      return res.status(404).json({ error: 'Screenshot not available' });
    }
    const team = db.seasons.getTeam(teamId, false);
    if (!team || team.SeasonId !== seasonId) return res.status(404).json({ error: 'Screenshot not found' });
    const screenshot = db.seasons.screenshot(teamId, playerId);
    if (!screenshot) return res.status(404).json({ error: 'Screenshot not found' });
    return res.set({ 'Content-Type': screenshot.ScreenshotMime, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff' }).send(screenshot.ScreenshotData);
  } catch (error) { return respond(res, error); }
});

adminSeasonRoutes.post('/:seasonId/groups', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const name = text(req.body?.groupName, 60);
  if (!seasonId || !name) return res.status(400).json({ error: 'Enter a group name' });
  try { return res.status(201).json({ group: db.seasons.addGroup(seasonId, name) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.delete('/:seasonId/groups/:groupId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const groupId = id(req.params.groupId);
  if (!seasonId || !groupId) return res.status(400).json({ error: 'Invalid group' });
  try { return res.json({ group: db.seasons.removeGroup(seasonId, groupId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.patch('/:seasonId/groups/:groupId', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const groupId = id(req.params.groupId);
  const name = text(req.body?.groupName, 60);
  if (!seasonId || !groupId || !name) return res.status(400).json({ error: 'Enter a valid group name' });
  try { return res.json({ group: db.seasons.renameGroup(seasonId, groupId, name) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.post('/:seasonId/groups/randomize', (req, res) => {
  const seasonId = id(req.params.seasonId);
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  try { return res.json(db.seasons.randomize(seasonId)); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.patch('/:seasonId/teams/:teamId/group', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const teamId = id(req.params.teamId);
  const groupId = req.body?.groupId === null ? null : id(req.body?.groupId);
  if (!seasonId || !teamId || (req.body?.groupId !== null && !groupId)) {
    return res.status(400).json({ error: 'Invalid assignment' });
  }
  try { return res.json({ team: db.seasons.assignTeam(seasonId, teamId, groupId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.post('/:seasonId/start', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const rawLeagueId = req.body?.leagueId;
  const leagueId = rawLeagueId === undefined || rawLeagueId === null || rawLeagueId === ''
    ? null : id(rawLeagueId);
  if (!seasonId || (leagueId === null && rawLeagueId !== undefined && rawLeagueId !== null && rawLeagueId !== '')) {
    return res.status(400).json({ error: 'Enter a valid external League ID' });
  }
  try { return res.json({ season: db.seasons.start(seasonId, leagueId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/:seasonId/rules', (req, res) => {
  const seasonId = id(req.params.seasonId);
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  try {
    if (!db.seasons.get(seasonId)) return res.status(404).json({ error: 'Season not found' });
    return res.json({ rules: db.seasons.getRules(seasonId) });
  } catch (error) { return respond(res, error); }
});

adminSeasonRoutes.put('/:seasonId/rules', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const values = req.body || {};
  if (!seasonId || !['UpperBracketTeams', 'LowerBracketTeams', 'EliminatedTeams'].every(key =>
    Number.isSafeInteger(Number(values[key])) && Number(values[key]) >= 0) ||
    typeof values.HasTiebreaker !== 'boolean' ||
    (values.HasTiebreaker && !id(values.TiebreakerPosition))) {
    return res.status(400).json({ error: 'Enter valid league rules' });
  }
  try { return res.json({ rules: db.seasons.saveRules(seasonId, values) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.get('/:seasonId/championCandidates', (req, res) => {
  const seasonId = id(req.params.seasonId);
  if (!seasonId) return res.status(400).json({ error: 'Invalid season' });
  try { return res.json({ teams: db.seasons.championTeams(seasonId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.post('/:seasonId/end', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const championId = id(req.body?.championTeamId);
  if (!seasonId || !championId) return res.status(400).json({ error: 'Select the champion' });
  try { return res.json({ season: db.seasons.end(seasonId, championId) }); }
  catch (error) { return respond(res, error); }
});

adminSeasonRoutes.patch('/:seasonId/champion', (req, res) => {
  const seasonId = id(req.params.seasonId);
  const championId = id(req.body?.championTeamId);
  if (!seasonId || !championId) return res.status(400).json({ error: 'Select the champion' });
  try { return res.json({ season: db.seasons.correctChampion(seasonId, championId) }); }
  catch (error) { return respond(res, error); }
});
