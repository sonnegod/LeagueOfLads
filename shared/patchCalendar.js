const releaseDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
});
const reportingTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

// Reporting policy: 01:00 New York on Valve's release date, not the actual rollout time.
export function patchReportingStart(sourceTimestamp) {
  const parts = Object.fromEntries(releaseDateFormat.formatToParts(new Date(sourceTimestamp))
    .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, 1);
  let instant = target;
  for (let i = 0; i < 2; i++) {
    const local = Object.fromEntries(reportingTimeFormat.formatToParts(new Date(instant))
      .filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    instant += target - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  }
  return new Date(instant).toISOString();
}
