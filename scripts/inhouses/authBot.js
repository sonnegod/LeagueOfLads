import 'dotenv/config';
import SteamUser from 'steam-user';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {botAuthPath, readBotAuth, writeBotAuth, BOT_COUNT} from '../../inhouses/botAuth.js';

const id = Number(process.argv[2]);
if (process.argv.length !== 3 || !Number.isInteger(id) || id < 1 || id > BOT_COUNT) throw new Error('Use: node scripts/inhouses/authBot.js <1-5>');
if (!process.stdin.isTTY) throw new Error('Run this authentication command in an interactive terminal');
let hidden = false;
const output = new Writable({write(chunk, encoding, callback) {if (!hidden) process.stdout.write(chunk, encoding); callback();}});
const prompt = createInterface({input: process.stdin, output, terminal: true});
async function ask(question, secret = false) {
  process.stdout.write(question); hidden = secret;
  try {return (await prompt.question('')).trim();}
  finally {hidden = false; if (secret) process.stdout.write('\n');}
}
const user = new SteamUser({dataDirectory: null, autoRelogin: false, renewRefreshTokens: true});
let refreshToken, saved = false;
const finish = new Promise((resolve, reject) => {
  function save() {
    if (!refreshToken || !user.steamID || saved) return;
    try {
      const steamId = user.steamID.getSteamID64();
      for (let slot = 1; slot <= BOT_COUNT; slot++) {
        if (slot !== id && readBotAuth(slot)?.steamId === steamId) throw new Error(`That Steam account already belongs to bot ${slot}. Use a different account.`);
      }
      writeBotAuth(id, {steamId, refreshToken}); saved = true;
      console.log(`Steam ID: ${steamId}. Authorize this account as an admin for the shared inhouse ticket.`);
      console.log(`Bot ${id} authenticated. Session saved to ${botAuthPath(id)}. Restart the inhouse worker to load it.`);
      resolve();
    } catch (error) {reject(error);}
  }
  user.on('refreshToken', token => {refreshToken = token; save();});
  user.on('loggedOn', save);
  user.on('steamGuard', (domain, callback, lastCodeWrong) => {
    if (lastCodeWrong) console.log('Steam rejected that code. Try the current code.');
    ask(domain ? `Steam Guard email code (${domain}): ` : 'Steam Guard authenticator code: ', true).then(callback, reject);
  });
  user.on('error', error => reject(new Error(`Steam authentication failed (code ${Number(error.eresult) || 'unknown'}).`)));
});
try {
  console.log(`Authenticate dedicated lobby bot ${id}. Stop this account's worker session before reauthenticating.`);
  const accountName = await ask('Steam account name: '), password = await ask('Steam password (hidden): ', true);
  if (!accountName || !password) throw new Error('Account name and password are required');
  user.logOn({accountName, password});
  await finish;
} catch (error) {console.error(error.message); process.exitCode = 1;}
finally {prompt.close(); user.logOff();}
