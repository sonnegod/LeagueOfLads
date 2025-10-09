import RecentMatchTable from "../components/RecentMatchTable";

export default function Home() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh', // fills viewport
    }}>
      <RecentMatchTable />
    </div>
  );
}
