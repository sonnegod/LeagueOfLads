import Database from 'better-sqlite3';
import { syncDraftPatches } from '../../config/draftMeta.js';
const db = new Database(process.argv[2] || 'db/LadsData.db');
try { console.log(JSON.stringify(await syncDraftPatches(db, { limit: Math.min(100, Math.max(0, Number(process.argv[3] || 8))) }))); }
finally { db.close(); }
