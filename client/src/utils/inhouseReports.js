export const inhouseReportStorageKey = userId => `inhouses:dismissed-reports:${userId}`;

export function readDismissedInhouseReports(storage, userId) {
  if (!userId) return [];
  try {
    const value = JSON.parse(storage.getItem(inhouseReportStorageKey(userId)) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter(id => Number.isSafeInteger(id) && id > 0))].slice(-100) : [];
  } catch {return [];}
}

export function dismissInhouseReport(storage, userId, gameId, previous = []) {
  const ids = [...new Set([...previous, ...readDismissedInhouseReports(storage, userId), gameId])].slice(-100);
  try {if (userId) storage.setItem(inhouseReportStorageKey(userId), JSON.stringify(ids));} catch { /* Still dismiss in this tab when storage is unavailable. */ }
  return ids;
}
