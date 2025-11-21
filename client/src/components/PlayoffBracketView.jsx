// src/components/PlayoffBracketView.jsx
import React, { useEffect, useState } from "react";

export default function PlayoffBracketView() {
  const [bracket, setBracket] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/playoffBracket");
        const data = await res.json();
        setBracket(data || []);
      } catch (err) {
        console.error("Failed to load playoff bracket", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p>Loading playoff bracket...</p>;

  return (
    <div style={{ padding: "1rem" }}>
      <h2 style={{ textAlign: "center" }}>Playoff Bracket</h2>

      {/* Placeholder for D3, you can drop your DoubleElimBracket component here */}
      <div style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: "1rem",
        background: "white"
      }}>
        <p>Bracket goes here</p>
      </div>
    </div>
  );
}
