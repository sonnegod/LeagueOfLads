import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

class PublicDBInstance {
  constructor() {
    if (!PublicDBInstance.instance) {
      const dbPath =
        process.env.ENVIRONMENT === 'DEV'
          ? './db/public.db'
          : '/root/LeagueOfLads/db/public.db';

      this.db = new Database(dbPath);
      PublicDBInstance.instance = this;
    }

    return PublicDBInstance.instance;
  }

  queryDatabase(query, params = []) {
    try {
      const stmt = this.db.prepare(query);
      return stmt.all(...params);
    } catch (err) {
      console.log(
        `Error executing public query: ${query} with params ${JSON.stringify(params)}: ${err}`
      );
      return [];
    }
  }
}

const dbPublic = new PublicDBInstance();
export default dbPublic;
