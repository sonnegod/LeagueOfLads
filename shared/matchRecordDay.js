const nyDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});

export function matchRecordDay(value) {
  const text=String(value||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  // Older SQLite timestamps without an offset were stored in UTC.
  const normalized=text.replace(' ','T');
  const date=new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)?normalized:`${normalized}Z`);
  return Number.isNaN(date.getTime())?'':nyDate.format(date);
}
