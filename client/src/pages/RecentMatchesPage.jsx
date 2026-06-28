import RecentMatchTable from "../components/RecentMatchTable";

export default function RecentMatchesPage() {
  return (
    <div className="recent-matches-page" style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: 'calc(100dvh - var(--navbar-height))',
    }}>
      <RecentMatchTable />
    </div>
  );
}
