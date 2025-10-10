import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CurrentLeagueSeries from "../components/CurrentLeagueSeries";


export default function Home() {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  

  useEffect(() => {
    async function fetchRecentSeries() {
      setLoading(true);
      try {
        const res = await fetch("/api/homepageSeries");
        const data = await res.json();
        console.log(data);
        setSeries(data);
      } catch (err) {
        console.error("Error fetching series:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchRecentSeries();
  }, []);


  if (loading) return <div>Loading recent series...</div>;

  return (
    <div style={{ padding: "1rem" }}>
      <h1>Recent Series</h1>
      <CurrentLeagueSeries seriesList={series} />

      <hr style={{ margin: "2rem 0" }} />

      <h2>Group Leaderboard (Coming Soon)</h2>
      {/*<CurrentLeaderboardTable />*/}
    </div>
  );
}

