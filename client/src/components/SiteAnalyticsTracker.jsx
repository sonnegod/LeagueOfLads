import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { analyticsPage, analyticsSource, configureSiteAnalytics, flushSiteAnalytics,
  trackSiteEvent } from '../utils/siteAnalytics';

export default function SiteAnalyticsTracker() {
  const { user, loading } = useAuth();
  const { pathname, search, key } = useLocation();
  const lastView = useRef(null);
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  const excluded = loading || Boolean(user?.isAdmin || user?.isSiteManager)
    || pathname === '/admin' || pathname === '/site-management'
    || (pathname.startsWith('/signup/') && new URLSearchParams(search).get('preview') === '1');
  useEffect(() => {
    let active = true;
    configureSiteAnalytics(excluded).then(allowed => {
      if (!active || !allowed) return;
      const page = analyticsPage(pathname);
      // StrictMode/auth updates do not count as additional navigations.
      if (page && lastView.current !== `${key}:${pathname}`) {
        lastView.current = `${key}:${pathname}`;
        trackSiteEvent('page_view', { page, source: analyticsSource() });
      }
    });
    return () => { active = false; };
  }, [excluded, key, pathname, preferenceVersion]);
  useEffect(() => {
    const preferenceChanged = () => setPreferenceVersion(value => value + 1);
    const flush = () => { if (document.visibilityState === 'hidden') flushSiteAnalytics(); };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flushSiteAnalytics);
    window.addEventListener('lads-analytics-preference', preferenceChanged);
    window.addEventListener('storage', preferenceChanged);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flushSiteAnalytics);
      window.removeEventListener('lads-analytics-preference', preferenceChanged);
      window.removeEventListener('storage', preferenceChanged);
    };
  }, []);
  return null;
}
