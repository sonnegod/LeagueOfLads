import React, { useEffect, useState } from "react";

export default function CurrentLeagueTeams({ refreshKey }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
    const [expandedTeamId, setExpandedTeamId] = useState(null);
  const [teamMatches, setTeamMatches] = useState([]);

  useEffect(() => {
    fetch("/api/admin/currentLeagueTeams")
      .then(res => res.json())
      .then(data => {
        setTeams(data.result  || []);
        setLoading(false);
      })
      .catch(err => {
        console.error("Load error:", err);
        setLoading(false);
      });

  }, [refreshKey]);

  const toggleExpand = async (teamId) => {
    if (expandedTeamId === teamId) {
      // collapse
      setExpandedTeamId(null);
      setTeamMatches([]);
      return;
    }

    setExpandedTeamId(teamId);

    try {
      const res = await fetch(`/api/admin/currentLeagueTeamMatches/${teamId}`);
      const data = await res.json();
      setTeamMatches(data.result || []);
    } catch (err) {
      console.error("Match load error:", err);
      setTeamMatches([]);
    }
  };

  if (loading) return <div>Loading teams...</div>;

  return (
    <div style={adminWidgetStyle}>
      <h3>Current Teams</h3>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#eee" }}>
            <th style={{ padding: 8, border: "1px solid #ccc" }}>Team ID</th>
            <th style={{ padding: 8, border: "1px solid #ccc" }}>Team Name</th>
            <th style={{ padding: 8, border: "1px solid #ccc" }}>Matches Played</th>
            <th style={{ padding: 8, border: "1px solid #ccc" }}>Wins</th>
            <th style={{ padding: 8, border: "1px solid #ccc" }}>Losses</th>
          </tr>
        </thead>

        <tbody>
          {teams.map(team => (
            <React.Fragment key={team.TeamId}>
              <tr
                onClick={() => toggleExpand(team.TeamId)}
                style={{
                  cursor: "pointer",
                  background: expandedTeamId === team.TeamId ? "#eef5ff" : "white"
                }}
              >
                <td>{team.TeamId}</td>
                <td>{team.TeamName}</td>
                <td style={{ textAlign: "center" }}>{team.MatchesPlayed}</td>
                <td style={{ textAlign: "center" }}>{team.Wins}</td>
                <td style={{ textAlign: "center" }}>{team.Losses}</td>
              </tr>

              {/* EXPANDED SECTION */}
              {expandedTeamId === team.TeamId && (
                <tr>
                  <td colSpan="2">
                    {/* Nested Table */}
                    <table
                      border="1"
                      cellPadding="6"
                      style={{
                        width: "100%",
                        background: "#fdfdfd",
                        marginTop: 10
                      }}
                    >
                      <thead>
                        <tr>
                          <th>Match ID</th>
                        </tr>
                      </thead>

                      <tbody>
                        {teamMatches.length === 0 && (
                          <tr>
                            <td colSpan="4" style={{ textAlign: "center" }}>
                              No matches found
                            </td>
                          </tr>
                        )}

                        {teamMatches.map((m) => (
                          <tr key={m.MatchId}>
                            <td style={{ textAlign: "center" }}>{m.MatchId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const adminWidgetStyle = {
  border: "1px solid #ccc",
  borderRadius: "8px",
  padding: "16px",
  overflowY: "auto"       // <-- For scrollable widgets
};

