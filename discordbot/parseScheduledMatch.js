const easternFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

function easternParts(date) {
  return Object.fromEntries(easternFormatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

function easternWallTimeUtc(year, month, day, hour, minute) {
  const matches = [4, 5].map(offset => new Date(Date.UTC(
    year, month - 1, day, hour + offset, minute)))
    .filter(date => {
      const parts = easternParts(date);
      return parts.year === year && parts.month === month && parts.day === day &&
        parts.hour === hour && parts.minute === minute;
    });
  return matches.length === 1 ? matches[0].toISOString() : null;
}

export function parseScheduledMatch(message) {
  const roles = [...(message?.mentions?.roles?.values?.() || [])];
  const content = message?.content || '';
  const createdAt = new Date(message?.createdAt || message?.createdTimestamp);
  if (roles.length < 2 || Number.isNaN(createdAt.getTime())) return null;
  const created = easternParts(createdAt);
  const dateMatch = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(content);
  let year;
  let month;
  let day;
  if (dateMatch) {
    month = Number(dateMatch[1]);
    day = Number(dateMatch[2]);
    year = dateMatch[3] ? Number(dateMatch[3]) : created.year;
    if (year < 100) year += 2000;
    if (!dateMatch[3]) {
      const proposed = Date.UTC(year, month - 1, day);
      const posted = Date.UTC(created.year, created.month - 1, created.day);
      if (proposed - posted > 180 * 86400000) year -= 1;
      else if (posted - proposed > 180 * 86400000) year += 1;
    }
  } else if (/\btonight\b/i.test(content)) {
    ({ year, month, day } = created);
  } else return null;
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() + 1 !== month ||
    checked.getUTCDate() !== day) return null;
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeMatch = /(?:^|\s|at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:est|edt|et)\b/i
    .exec(content);
  let startAt = null;
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] || 0);
    const meridian = timeMatch[3]?.toLowerCase();
    if (minute < 60 && hour >= 1 && hour <= 12 && (meridian || hour >= 6)) {
      if (meridian === 'am') hour %= 12;
      else if (meridian === 'pm' || !meridian) hour = (hour % 12) + 12;
      startAt = easternWallTimeUtc(year, month, day, hour, minute);
    }
  }
  return { team1: roles[0].name, team2: roles[1].name, date,
    startAt, sourceMessageId: message.id || null };
}
