// Widen the format constraint without changing fixture IDs, revisions or links.
export function allowSingleGameFixtures(db) {
  const old=/CHECK\s*\(\s*BestOf\s+IN\s*\(\s*2\s*,\s*3\s*,\s*5\s*\)\s*\)/i;
  const read=()=>db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ScheduledEvents'").get()?.sql;
  if(!old.test(read()||''))return;
  if(db.inTransaction)throw new Error('Initialize scheduling outside an existing transaction');
  const foreignKeys=db.pragma('foreign_keys',{simple:true});
  try {
    db.pragma('foreign_keys = OFF');
    db.transaction(()=>{
      const sql=read();if(!old.test(sql))return;
      const objects=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='ScheduledEvents' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
      const sequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='ScheduledEvents'").get()?.seq||0;
      const columns=db.pragma('table_info(ScheduledEvents)').map(c=>'"'+c.name.replaceAll('"','""')+'"').join(',');
      db.exec(sql.replace(old,'CHECK(BestOf IN (1,2,3,5))').replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?ScheduledEvents["`\]]?\s*/i,'CREATE TABLE ScheduledEvents_format_migration '));
      db.exec(`INSERT INTO ScheduledEvents_format_migration(${columns}) SELECT ${columns} FROM ScheduledEvents;
        DROP TABLE ScheduledEvents;ALTER TABLE ScheduledEvents_format_migration RENAME TO ScheduledEvents;`);
      for(const object of objects)db.exec(object.sql);
      db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='ScheduledEvents'").run(sequence);
      if(db.pragma('foreign_key_check(ScheduledEvents)').length)throw new Error('Fixture format migration found invalid references');
    }).immediate();
  }finally{db.pragma(`foreign_keys = ${foreignKeys?'ON':'OFF'}`);}
}
