import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CurrentLeagueSeries from "../components/CurrentLeagueSeries";
import CurrentLeaderboardTable from "../components/CurrentLeaderboardTable";

export default function Home() {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);
  

  useEffect(() => {
    async function fetchRecentSeries() {
      setLoading(true);
      try {
        const res = await fetch("/api/homepageSeries");
        const data = await res.json();

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
      <h1>Group Leaderboard</h1>
      <CurrentLeaderboardTable />      

      <hr style={{ margin: "2rem 0" }} />

      <h2>Recent Series</h2>
      <CurrentLeagueSeries seriesList={series} />
    </div>
  );
}

