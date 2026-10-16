import { useState } from 'react';
import { analyticsOptedOut, setAnalyticsOptOut } from '../utils/siteAnalytics';

export default function PrivacyPolicy() {
  const [optedOut, setOptedOut] = useState(analyticsOptedOut);
  return (
    <div className="ui-page" style={pageStyle}>
      <section className="ui-panel" style={cardStyle}>
        <h1>Privacy Policy</h1>
        <p style={updatedStyle}>Last updated: October 16, 2026</p>

        <p>
          League of Lads uses Steam sign-in, league submissions, and first-party site metrics to
          operate the league and improve the website.
        </p>

        <h2>Information We Collect</h2>
        <p>
          Steam sign-in provides your account identifier and public profile details. A session cookie
          keeps you signed in for up to a week. Team signups include roster information, MMR values,
          player profile links, and screenshots. MMR screenshots are available only to league admins.
          The site also displays league, team, player, and match statistics.
        </p>

        <h2>Analytics and Tracking</h2>
        <p>
          We use an anonymous first-party browser cookie, lads_visitor, for up to 90 days to estimate
          visitors, returning visits, page categories, feature usage, signup progress, and referral
          categories. Site analytics does not store Steam IDs, IP addresses, search text, full page or
          referral URLs, screenshots, or form contents. The anonymous identifier is hashed before
          storage. Daily usage records are deleted after 90 days. Aggregate API status and response
          time measurements help monitor reliability. Analytics is visible only to site managers.
        </p>
        <p>
          We do not use a third-party analytics or advertising service. Browser Do Not Track and
          Global Privacy Control signals disable browser usage collection. You may also opt out on
          this browser; aggregate API health measurements continue without a browser identifier.
        </p>
        <label><input type="checkbox" checked={optedOut} onChange={event => {
          setAnalyticsOptOut(event.target.checked);
          setOptedOut(event.target.checked);
        }} /> Exclude this browser from site usage analytics</label>

        <h2>Data Sharing</h2>
        <p>
          Steam handles authentication. League submissions are used for league administration, and
          roster information is used in public league features. We do not sell analytics information.
        </p>

        <h2>Contact</h2>
        <p>
          If you have questions about this privacy policy, contact the League of Lads administrator.
        </p>
      </section>
    </div>
  );
}

const pageStyle = {
  padding: '2rem',
  color: 'var(--text, #e6e6e6)',
};

const cardStyle = {
  maxWidth: '820px',
  margin: '0 auto',
  padding: '1.5rem',
  border: '1px solid var(--border, #222428)',
  borderRadius: '12px',
  background: 'var(--surface, #121315)',
  lineHeight: 1.6,
};

const updatedStyle = {
  color: 'var(--muted-text, #9aa0b4)',
};
