let enabled = null;
let excluded = true;
let configuring;
let queue = [];
let timer;
let sending = false;

export function analyticsOptedOut() {
  try { return localStorage.getItem('lads.analytics.optOut') === '1'; } catch { return true; }
}
const declined = () => analyticsOptedOut() || navigator.doNotTrack === '1'
  || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;

export function setAnalyticsOptOut(value) {
  try { localStorage.setItem('lads.analytics.optOut', value ? '1' : '0'); } catch { return; }
  if (value) {
    queue = [];
    fetch('/api/site-analytics/events', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
  }
  window.dispatchEvent(new Event('lads-analytics-preference'));
}

export async function configureSiteAnalytics(isExcluded) {
  excluded = isExcluded;
  if (excluded || declined()) { queue = []; return false; }
  if (enabled === null) {
    configuring ??= fetch('/api/site-analytics/config', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : { enabled: false })
      .then(data => { enabled = data.enabled === true; })
      .catch(() => { enabled = false; });
    await configuring;
  }
  return enabled && !excluded && !declined();
}

export function trackSiteEvent(name, fields = {}) {
  if (excluded || declined() || enabled === false || queue.length >= 20) return;
  queue.push({ name, ...fields });
  clearTimeout(timer);
  timer = setTimeout(flushSiteAnalytics, 750);
}

export async function flushSiteAnalytics() {
  clearTimeout(timer);
  if (sending || !queue.length || declined() || excluded || !enabled) return;
  sending = true;
  const events = queue.splice(0, 20);
  try {
    await fetch('/api/site-analytics/events', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }), keepalive: true });
  } catch { /* Usage collection never blocks navigation or retries indefinitely. */ }
  finally {
    sending = false;
    if (queue.length) timer = setTimeout(flushSiteAnalytics, 750);
  }
}

export function analyticsPage(pathname) {
  if (/^\/(admin|site-management|dashboard|privacy-policy)(\/|$)/.test(pathname)) return null;
  if (pathname === '/') return 'home';
  if (/^\/(recents|recentMatches)\/?$/.test(pathname)) return 'recents';
  const detail = /^\/(league|player|team|match|series|hero|signup)\/(?:roster\/)?\d+\/?$/.exec(pathname);
  if (detail) return detail[1];
  if (/^\/(h2h|rules|betting|awards)\/?$/.test(pathname)) return pathname.split('/')[1];
  if (/^\/(league|player|team|match|hero|search|request|draftgod|live)\/?$/.test(pathname)) return 'other';
  return null;
}

export function analyticsSource() {
  const campaign = new URLSearchParams(location.search).get('utm_source')?.toLowerCase();
  if (campaign === 'discord') return 'Discord';
  if (campaign === 'google') return 'Google';
  if (campaign) return 'Other';
  try {
    if (!document.referrer) return 'Direct';
    const referrer = new URL(document.referrer);
    if (referrer.hostname === location.hostname) return 'Direct';
    if (/(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/.test(referrer.hostname)) return 'Discord';
    if (/(^|\.)google\.[a-z.]+$/.test(referrer.hostname)) return 'Google';
    return 'Other';
  } catch { return 'Direct'; }
}
