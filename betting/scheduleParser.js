export const PARSER_VERSION = 7;
export const LEAGUE_TIMEZONE = 'America/New_York';
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const weekdayAliases = {sun:'sunday',mon:'monday',tue:'tuesday',tues:'tuesday',wed:'wednesday',weds:'wednesday',
  thu:'thursday',thur:'thursday',thurs:'thursday',fri:'friday',sat:'saturday'};
const formatters=new Map();
const formatter = timezone => {
  if(!formatters.has(timezone)) {
    const value=new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if(formatters.size>=32)formatters.delete(formatters.keys().next().value);formatters.set(timezone,value);
  }
  return formatters.get(timezone);
};
const parts = (date, timezone) => Object.fromEntries(formatter(timezone).formatToParts(date)
  .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));

// Try all realistic UTC offsets, then require an exact round trip. DST gaps
// produce zero matches; repeated wall times produce two and need clarification.
export function localToUtc({ year, month, day, hour, minute }, timezone = LEAGUE_TIMEZONE) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const candidates = [];
  for (let offset = -840; offset <= 840; offset += 15) {
    const date = new Date(wall - offset * 60000); const p = parts(date, timezone);
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) candidates.push(date.toISOString());
  }
  return candidates.length === 1 ? { utc: candidates[0] } : { error: candidates.length ? 'ambiguous_dst_time' : 'invalid_local_time' };
}

export function parseScheduleTime(text, authoredAt, horizonDays = 60, {allowPast=false,weekdayFallback=false} = {}) {
  const reference = new Date(authoredAt);
  if (!Number.isFinite(reference.getTime())) return { error: 'invalid_message_time' };
  text = String(text).toLowerCase()
    .replace(/[*`~]+/g,' ')
    .replace(/(?<!\w)_+|_+(?!\w)/g,' ')
    .replace(/\b(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)\b\.?/g,word=>weekdayAliases[word.replace('.','')]);
  if(/\b(?:last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|yesterday|played|finished)\b/.test(text))return {error:'retrospective_post'};
  if(/\b(?:bst|cet|cest|ist|aest|aedt|jst)\b/.test(text))return {error:'unknown_timezone'};
  let timezone = LEAGUE_TIMEZONE;
  let explicitZone = text.match(/\b(america\/[a-z_]+|europe\/[a-z_]+|utc|gmt|pst|pdt|cst|cdt|mst|mdt|est|edt|et|pt|ct|mt)\b/i)?.[1];
  const zones = { utc: 'UTC', gmt: 'UTC', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
    cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver',
    est: LEAGUE_TIMEZONE, edt: LEAGUE_TIMEZONE, et: LEAGUE_TIMEZONE };
  if (explicitZone) timezone = zones[explicitZone] || explicitZone.replace(/^america\//, 'America/').replace(/^europe\//, 'Europe/');
  try { formatter(timezone).format(reference); } catch { return { error: 'unknown_timezone' }; }
  // A complete numeric timestamp is authoritative over human-readable prose
  // that may repeat its clock or name a different weekday. Keep the post's
  // timezone, but never fall back to a weekday if this explicit value is invalid.
  const offset = text.match(/(?:utc|gmt)\s*([+-])(\d{1,2})(?::?(\d{2}))?\b/i);
  const numericTimes = [...text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}[\s,]+\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)(?!\w)/g)];
  if(numericTimes.length>1)return {error:'conflicting_times'};
  if(numericTimes.length===1){text=numericTimes[0][0];weekdayFallback=false;}
  const times = [...text.matchAll(/(?:^|[\s,@])([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.|est|edt|et|pst|pdt|pt|cst|cdt|ct|mst|mdt|mt|utc|gmt)(?=\b|\s|$)/g)];
  if (!times.length) {
    const bare = [...text.matchAll(/(?:^|\s)([01]?\d|2[0-3])(?::([0-5]\d))?(?=\s*$)/g)];
    times.push(...bare);
  }
  if (times.length !== 1) return { error: times.length ? 'conflicting_times' : 'missing_time' };
  const time = times[0]; let hour = Number(time[1]); const minute = Number(time[2] || 0);
  const meridiem = time[3]?.replaceAll('.', '');
  const isMeridiem = ['am', 'pm'].includes(meridiem);
  if(!explicitZone&&zones[meridiem]){explicitZone=meridiem;timezone=zones[meridiem];}
  if (isMeridiem && (hour < 1 || hour > 12)) return { error: 'invalid_hour' };
  if (isMeridiem) hour = hour % 12 + (meridiem === 'pm' ? 12 : 0);
  const clock24 = !isMeridiem && (hour===0 || hour>12 || !!time[2]&&time[1].length===2&&time[1].startsWith('0'));
  if (!isMeridiem && !clock24) hour = hour % 12 + 12;
  // Numeric offsets are authoritative; colloquial EST is deliberately New York.
  const dates = [...text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)];
  const days = weekdays.filter(d => new RegExp(`\\b${d}\\b`).test(text));
  if (days.length > 1 || (dates.length > 1 && (!weekdayFallback || !days.length))) return { error: 'conflicting_dates' };
  if (!dates.length && !days.length) return { error: 'missing_date' };
  const offsetMinutes=offset?(Number(offset[2])*60+Number(offset[3]||0))*(offset[1]==='+'?1:-1):null;
  const current = offset?parts(new Date(reference.getTime()+offsetMinutes*60000),'UTC'):parts(reference, timezone); let year; let month; let day;
  const assumptions = numericTimes.length ? ['Explicit numeric date and time used'] : [];
  let dateAssumptions = [];
  if (!isMeridiem && !clock24) assumptions.push('PM assumed');
  if (!explicitZone && !offset) assumptions.push('New York timezone assumed');
  const useWeekday = (fallback=false) => {
    const base = new Date(Date.UTC(current.year, current.month - 1, current.day));
    const delta = (weekdays.indexOf(days[0]) - base.getUTCDay() + 7) % 7;
    base.setUTCDate(base.getUTCDate() + delta);
    if (!delta && (hour < current.hour || (hour === current.hour && minute <= current.minute))) base.setUTCDate(base.getUTCDate() + 7);
    year = base.getUTCFullYear(); month = base.getUTCMonth() + 1; day = base.getUTCDate();
    dateAssumptions = ['Next weekday occurrence'];
    if(fallback)dateAssumptions.push(`Written date could not be verified; next ${days[0]} assumed`);
  };
  if (dates.length === 1) {
    const d = dates[0]; year = Number(d[1] || d[6] || current.year); month = Number(d[2] || d[4]); day = Number(d[3] || d[5]);
    if (!d[1] && !d[6]) {
      dateAssumptions.push('Year inferred');
      if (Date.UTC(year, month - 1, day + 1) < Date.UTC(current.year, current.month - 1, current.day)) year++;
    }
  } else {
    useWeekday(dates.length>1);
  }
  const resolveDate = () => {
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return { error: 'invalid_date' };
    if (days.length && calendar.getUTCDay() !== weekdays.indexOf(days[0])) return { error: 'weekday_date_conflict' };
    let result;
    if (offset) {
      const minutes = Number(offset[2]) * 60 + Number(offset[3] || 0);
      if (minutes > 840 || Number(offset[3] || 0) > 59) return { error: 'invalid_offset' };
      result = { utc: new Date(Date.UTC(year, month - 1, day, hour, minute) - (offset[1] === '+' ? minutes : -minutes) * 60000).toISOString() };
      timezone = offset[0].toUpperCase();
    } else result = localToUtc({ year, month, day, hour, minute }, timezone);
    if (result.error) return result;
    const distance = Date.parse(result.utc) - reference.getTime();
    if ((!allowPast&&distance < -3600000) || distance > horizonDays * 86400000) return { error: 'outside_scheduling_horizon' };
    return { scheduledStartUtc: result.utc, timezone, originalTimezone: explicitZone || offset?.[0] || null };
  };
  let result = resolveDate();
  if(weekdayFallback && days.length===1 && ['invalid_date','weekday_date_conflict','outside_scheduling_horizon'].includes(result.error)) {
    useWeekday(true);result=resolveDate();
  }
  return result.error ? result : {...result,assumptions:[...assumptions,...dateAssumptions]};
}

export function parseScheduleMessage(message, teams, roleAliases = []) {
  const content = String(message.content || '');
  const roles = [...content.matchAll(/<@&(\d+)>/g)].map(m => m[1]);
  const leading=content.match(/^\s*(\d{1,10})\s+(?:vs\.?|v\.?|against)\s+(\d{1,10})\b/i);
  const externalIds = [...new Set([...content.replace(/<@&\d+>/g, '').matchAll(/\b\d{6,10}\b/g)].map(m => Number(m[0]))
    .concat(leading?[Number(leading[1]),Number(leading[2])]:[]))];
  const ids = new Set();
  for (const role of roles) {
    const mapped = roleAliases.filter(a => String(a.RoleId) === role);
    const name = message.roleNames?.[role];
    const candidates = mapped.length ? mapped.map(a => teams.find(t => t.TeamSubmissionId === a.TeamSubmissionId)).filter(Boolean)
      : name ? teams.filter(t => t.TeamName.toLowerCase() === name.toLowerCase()) : [];
    if (candidates.length !== 1) return { error: 'unresolved_team_role' };
    ids.add(candidates[0].TeamSubmissionId);
  }
  for (const external of externalIds) {
    const candidates = teams.filter(t => t.ExternalTeamId === external);
    if (candidates.length !== 1) return { error: 'unresolved_team_id' };
    ids.add(candidates[0].TeamSubmissionId);
  }
  if (ids.size !== 2) return { error: 'need_two_unique_teams' };
  const parsed = parseScheduleTime(content.replace(/<@&\d+>/g, '').replace(/\b\d{6,10}\b/g, ''), message.editedAt || message.authoredAt,
    60,{weekdayFallback:true});
  if (parsed.error) return parsed;
  const stage = /\btiebreak/i.test(content) ? 'tiebreaker' : /\b(?:playoff|finals?|bo\s*[35])\b/i.test(content) ? 'playoff' : 'regular';
  const bestOf = Number(content.match(/\bbo\s*([235])\b/i)?.[1] || (stage === 'regular' ? 2 : /grand\s+final/i.test(content)?5:3));
  return { ...parsed, team1Key: [...ids][0], team2Key: [...ids][1], stage, bestOf,
    status: /\bforfeit(?:ed)?\b/i.test(content)?'forfeit':/\b(cancelled|canceled)\b/i.test(content) ? 'cancelled' : 'scheduled', parserVersion: PARSER_VERSION };
}
