import {useEffect, useState} from 'react';
import {dismissInhouseReport, readDismissedInhouseReports, inhouseReportStorageKey} from '../utils/inhouseReports';

const browserStorage = () => {try {return window.localStorage;} catch {return null;}};

export function useDismissedInhouseReports(userId) {
  const owner = String(userId || '');
  const [saved, setSaved] = useState(() => ({owner, ids: readDismissedInhouseReports(browserStorage(), owner)}));
  const ids = saved.owner === owner ? saved.ids : readDismissedInhouseReports(browserStorage(), owner);
  useEffect(() => {
    function reload(event) {
      if (event?.key && event.key !== inhouseReportStorageKey(owner)) return;
      setSaved({owner, ids: readDismissedInhouseReports(browserStorage(), owner)});
    }
    reload();
    window.addEventListener('storage', reload);
    window.addEventListener('inhouses:report-dismissed', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('inhouses:report-dismissed', reload);
    };
  }, [owner]);
  function dismiss(gameId) {
    const next = dismissInhouseReport(browserStorage(), owner, gameId, ids);
    window.dispatchEvent(new Event('inhouses:report-dismissed'));
    setSaved({owner, ids: next});
  }
  return {dismissed: ids, dismiss};
}
