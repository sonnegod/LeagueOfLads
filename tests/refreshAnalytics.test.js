import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { refreshAnalytics } from '../scripts/db/refreshAnalytics.js';
import { readHomeAnalytics } from '../routes/analyticsRoutes.js';

test('refresh builds player leaders and match feed without signup data or private ratings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lads-analytics-'));
  const ladsPath = path.join(dir, 'LadsData.db');
  const publicPath = path.join(dir, 'public.db');
  const analyticsPath = path.join(dir, 'Analytics.db');
  const lads = new Database(ladsPath);
  const publicDb = new Database(publicPath);
  try {
    lads.exec(`CREATE TABLE MatchLeague (MatchId INTEGER, LeagueId INTEGER, DatePlayed TEXT);
      CREATE TABLE MatchTeam (MatchId INTEGER, TeamRad INTEGER, TeamDire INTEGER, WinnerId INTEGER);
      CREATE TABLE MatchPlayer (MatchId INTEGER, PlayerId INTEGER, HeroId INTEGER, Kills INTEGER,
        Deaths INTEGER, Assists INTEGER, GPM INTEGER, XPM INTEGER, Lasthits INTEGER,
        HeroDamage INTEGER, Winner INTEGER);
      CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE TeamInfo (TeamId INTEGER, TeamName TEXT);
      CREATE TABLE SeriesMatch (MatchId INTEGER, SeriesId INTEGER);
      CREATE TABLE SeriesInfo (SeriesId INTEGER, Stage TEXT);
      INSERT INTO PlayerInfo VALUES (12, 'Sample player');
      INSERT INTO TeamInfo VALUES (20, 'Winners'), (21, 'Runners-up');
      INSERT INTO MatchLeague VALUES (101, 10, '2026-10-04'), (102, 10, '2026-10-05'),
        (103, 10, NULL);
      INSERT INTO MatchTeam VALUES (101, 20, 21, 20), (102, 20, 21, 21);
      INSERT INTO SeriesInfo VALUES (1, 'g');
      INSERT INTO SeriesMatch VALUES (101, 1), (102, 1);
      INSERT INTO MatchPlayer VALUES (101, 12, 1, 12, 4, 9, 600, 700, 200, 10000, 1),
        (102, 12, 2, 5, 8, 4, 450, 500, 100, 5000, 0),
        (103, 12, 2, 3, 2, 6, 300, 400, 90, 4000, 1);`);
    publicDb.exec(`CREATE TABLE PlayerInfo (PlayerId INTEGER, PlayerName TEXT);
      CREATE TABLE PublicMatchPlayer (MatchId INTEGER, PlayerId INTEGER, Won INTEGER,
        HeroId INTEGER, Kills INTEGER, Deaths INTEGER, Assists INTEGER, DateCreated TEXT);
      INSERT INTO PlayerInfo VALUES (12, 'Sample player');
      INSERT INTO PublicMatchPlayer VALUES
        (201, 12, 1, 3, 9, 1, 10, '2026-10-03T00:00:00.000Z'),
        (202, 12, 0, 4, 1, 7, 3, '2026-07-01T00:00:00.000Z');`);
    lads.close();
    publicDb.close();
    const input = { ladsPath, publicPath, analyticsPath, asOf: '2026-10-06T00:00:00.000Z' };
    const result = refreshAnalytics(input);
    assert.equal(result.signupDataAvailable, false);
    assert.equal(result.completedMatches, 2);
    assert.equal(result.weeklyPlayerRows, 2);
    const writableAnalytics = new Database(analyticsPath);
    writableAnalytics.prepare(`UPDATE CompletedMatchFacts
      SET PreMatchRadiantWinProbability = 0.65 WHERE MatchId = 101`).run();
    writableAnalytics.prepare(`INSERT INTO HomeFeedItems
      (ItemKey, LeagueId, FeedType, EventDate, Headline, RankScore, PublishedAt)
      VALUES ('editorial:1', 10, 'editorial', '2026-10-05', 'Editorial item', 1,
        '2026-10-05T12:00:00.000Z')`).run();
    writableAnalytics.close();
    assert.equal(refreshAnalytics(input).feedItems, result.feedItems + 1);
    const analytics = new Database(analyticsPath, { readonly: true });
    try {
      const stats = analytics.prepare('SELECT * FROM PlayerLeagueStats WHERE PlayerId = 12').get();
      assert.equal(stats.TotalKills, 20);
      assert.equal(stats.TotalDeaths, 14);
      assert.equal(stats.TotalAssists, 19);
      assert.equal(stats.MaxKills, 12);
      assert.equal(stats.MaxDeaths, 8);
      assert.equal(stats.MaxGPM, 600);
      assert.equal(stats.AvgGPM, 450);
      assert.equal(analytics.prepare('SELECT Games FROM PlayerRecentPublicStats').get().Games, 1);
      assert.equal(analytics.prepare('SELECT COUNT(*) AS n FROM HomeFeedItems').get().n, 3);
      assert.equal(analytics.prepare(`SELECT PreMatchRadiantWinProbability AS p
        FROM CompletedMatchFacts WHERE MatchId = 101`).get().p, 0.65);
      const home = readHomeAnalytics(analytics);
      assert.equal(home.leagueId, 10);
      assert.equal(home.leaders.find(item => item.key === 'TotalKills').players[0].value, 20);
      assert.equal(home.feed[0].summary, 'Group stage match');
      assert.doesNotMatch(JSON.stringify(home), /mmr|rating|screenshot/i);
    } finally { analytics.close(); }
    const beforePublicRefresh = new Database(analyticsPath, { readonly: true });
    const homeBefore = readHomeAnalytics(beforePublicRefresh);
    beforePublicRefresh.close();
    const leagueOnly = refreshAnalytics({ ...input, publicPath: path.join(dir, 'missing-public.db'), scope: 'league' });
    assert.equal(leagueOnly.recentPublicPlayerRows, 0);
    const publicOnly = refreshAnalytics({ ...input, ladsPath: path.join(dir, 'missing-lads.db'), scope: 'public' });
    assert.equal(publicOnly.leaguePlayerRows, 0);
    const after = new Database(analyticsPath, { readonly: true });
    try {
      assert.equal(after.prepare('SELECT Games FROM PlayerRecentPublicStats').get().Games, 1);
      assert.equal(after.prepare('SELECT COUNT(*) AS n FROM HomeFeedItems').get().n, 3);
      assert.equal(readHomeAnalytics(after).leaders[0].players[0].value, 20);
      assert.deepEqual(readHomeAnalytics(after), homeBefore);
    } finally { after.close(); }
  } finally {
    if (lads.open) lads.close();
    if (publicDb.open) publicDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
