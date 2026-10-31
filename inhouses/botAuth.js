import {readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const BOT_COUNT = 5;
export const botAuthDirectory = () => resolve(process.env.INHOUSE_BOT_AUTH_DIR || fileURLToPath(new URL('../db/inhouse-bots/', import.meta.url)));
export function botAuthPath(id) {
  if (!Number.isInteger(id) || id < 1 || id > BOT_COUNT) throw new Error('Choose a bot slot from 1 to 5');
  return resolve(botAuthDirectory(), `bot-${id}.json`);
}
export function readBotAuth(id) {
  try {
    const data = JSON.parse(readFileSync(botAuthPath(id), 'utf8'));
    if (typeof data.steamId !== 'string' || !/^\d{17}$/.test(data.steamId)
      || typeof data.refreshToken !== 'string' || !data.refreshToken) throw new Error();
    const account = BigInt(data.steamId) - 76561197960265728n;
    if (account < 1n || account >= 4294967295n) throw new Error();
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Bot ${id} authentication file is invalid. Run its authentication command again.`);
  }
}
export function writeBotAuth(id, data) {
  const directory = botAuthDirectory(), destination = botAuthPath(id), temporary = `${destination}.tmp`;
  mkdirSync(directory, {recursive: true, mode: 0o700});
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
  writeFileSync(temporary, JSON.stringify(data), {mode: 0o600});
  if (process.platform !== 'win32') chmodSync(temporary, 0o600);
  renameSync(temporary, destination);
}
