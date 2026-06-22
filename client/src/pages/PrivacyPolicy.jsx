export default function PrivacyPolicy() {
  return (
    <div style={pageStyle}>
      <section style={cardStyle}>
        <h1>Privacy Policy</h1>
        <p style={updatedStyle}>Last updated: June 22, 2026</p>

        <p>
          League of Lads does not collect, sell, rent, or share personal data from users of the
          application.
        </p>

        <h2>Information We Collect</h2>
        <p>
          We do not collect personal information through the application. The application displays
          league, team, match, hero, and live match information used for League of Lads features.
        </p>

        <h2>Analytics and Tracking</h2>
        <p>
          The application does not use third-party analytics, advertising trackers, or behavioral
          tracking.
        </p>

        <h2>Data Sharing</h2>
        <p>
          Because we do not collect personal data through the application, we do not sell or share
          personal data with third parties.
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
