export function contentWindow(period = 'all', now = new Date()) {
  if (!['overnight', 'week', 'historical', 'all'].includes(period)) throw new Error('Invalid content period');
  const days = period === 'overnight' ? 1 : period === 'week' ? 7 : null;
  return { key: period, label: period === 'overnight' ? 'Last 24 hours' : period === 'week' ? 'Last 7 days'
    : period === 'historical' ? 'Historical season' : 'Published highlights',
    from: days ? new Date(now.getTime() - days * 86400000).toISOString() : null,
    to: now.toISOString(), timezone: 'America/New_York' };
}
