import {inhouseFixture} from './inhouseFixture.js';
import {createInhouseBotPool} from '../../inhouses/botPool.js';
import {steamIdForPlayer} from '../../inhouses/botProtocol.js';
import {InhouseStore} from '../../inhouses/store.js';
export function inhouseBotFixture({botStartsRadiant = false,...options} = {}) {
  const f = inhouseFixture({...options,bots:0}), sessions = new Map(), commands = [];
  const auth = id => ({steamId: steamIdForPlayer(1000 + id), refreshToken: 'not-a-real-token'});
  const createSession = config => {
    const id = Number(BigInt(config.steamId) - 76561197960265728n) - 1000, previous = sessions.get(id);
    const session = {steamId: config.steamId, ready: true, status: 'connected', error: null,
      lobby: previous?.lobby || null, start() {}, close() {}, result() {return null;},
      details: async () => {throw new Error('Public and GC result lookup unavailable');},
      invite(playerId) {commands.push({id, name: 'invite', playerId});},
      command(name, data) {
        commands.push({id, name, data});
        const gameId = f.db.prepare('SELECT InhouseId FROM InhouseBots WHERE BotId=?').get(id).InhouseId;
        if (name === 'create') this.lobby = {...data.lobbyDetails, lobbyId: String(5000 + gameId), leaderId: config.steamId,
          allMembers: [{id: config.steamId, team: botStartsRadiant ? 0 : 4, slot: botStartsRadiant ? 1 : 0}], memberIndices: [0], state: 0, matchId: '0', matchOutcome: 0};
        if (name === 'details') Object.assign(this.lobby, data);
        if (name === 'team') this.lobby.allMembers.find(p => p.id === config.steamId).team = data.team;
        if (name === 'unseat') this.lobby.allMembers.find(p => p.id === steamIdForPlayer(data.accountId)).team = 4;
        if (name === 'kick') this.lobby.allMembers = this.lobby.allMembers.filter(p => p.id !== steamIdForPlayer(data.accountId));
        if (name === 'launch') Object.assign(this.lobby, {state: 2, matchId: String(90000 + gameId), gameStartTime: Math.floor(f.clock() / 1000)});
        if (name === 'leave') this.lobby = null;
      }};
    sessions.set(id, session); return session;
  };
  const poolOptions = {clock: f.clock, readAuth: auth, saveAuth: () => {}, createSession};
  let pool = createInhouseBotPool(f.store, poolOptions); pool.start(); pool.tick();
  f.store.saveSettings({...f.store.settings(), serverRegion: 2});
  function step() {f.advance(1000); pool.tick();}
  function fill(botId) {
    const session = sessions.get(botId), g = f.db.prepare('SELECT InhouseId FROM InhouseBots WHERE BotId=?').get(botId), game=f.store.game(g.InhouseId);
    session.lobby.allMembers = [{id: session.steamId, team: 3, slot: 0}, ...['A','B'].flatMap(side =>
      f.store.members(g.InhouseId).filter(p => p.side === side).map((p,index) =>
        ({id: steamIdForPlayer(p.playerId), team: side === game.lobbyChoices.radiantSide ? 0 : 1, slot: index + 1})))];
    session.lobby.memberIndices = session.lobby.allMembers.map((_, i) => i);
  }
  return {...f, sessions, commands, step, fill, get pool() {return pool;},
    restart() {pool.close(); pool = createInhouseBotPool(new InhouseStore(f.db, {clock: f.clock}), poolOptions); pool.start();},
    cleanup() {pool.close(); f.close();}};
}

