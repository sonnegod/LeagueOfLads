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
        console.log(data);
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

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "transparent" }}>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Team ID</th>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Team Name</th>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Matches Played</th>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Wins</th>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Losses</th>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Group Id</th>
            <th style={{ padding: 8, border: "1px solid var(--border, #222428)", color: "var(--text, #e6e6e6)" }}>Group Name</th>
          </tr>
        </thead>
        <tbody>
          {teams.map(team => (
            <React.Fragment key={team.TeamId}>
              <tr
                onClick={() => toggleExpand(team.TeamId)}
                style={{
                  cursor: "pointer",
                  background: expandedTeamId === team.TeamId ? "var(--surfaceElevated, #0f1113)" : "transparent",
                  color: "var(--text, #e6e6e6)"
                }}
              >
                <td style={{ border: "1px solid var(--border, #222428)", padding: 8 }}>{team.TeamId}</td>
                <td style={{ border: "1px solid var(--border, #222428)", padding: 8 }}>{team.TeamName}</td>
                <td style={{ textAlign: "center", border: "1px solid var(--border, #222428)", padding: 8 }}>{team.MatchesPlayed}</td>
                <td style={{ textAlign: "center", border: "1px solid var(--border, #222428)", padding: 8 }}>{team.Wins}</td>
                <td style={{ textAlign: "center", border: "1px solid var(--border, #222428)", padding: 8 }}>{team.Losses}</td>
                <td style={{ textAlign: "center", border: "1px solid var(--border, #222428)", padding: 8 }}>{team.GroupId}</td>
                <td style={{ textAlign: "center", border: "1px solid var(--border, #222428)", padding: 8 }}>{team.GroupName}</td>
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
                          background: "var(--surfaceElevated, #0f1113)",
                          marginTop: 10,
                          borderCollapse: "collapse"
                      }}
                    >
                      <thead>
                        <tr>
                            <th style={{ border: "1px solid var(--border, #222428)", padding: 8, color: "var(--text, #e6e6e6)" }}>Match ID</th>
                        </tr>
                      </thead>

                      <tbody>
                        {teamMatches.length === 0 && (
                          <tr>
                            <td colSpan="4" style={{ textAlign: "center", color: "var(--text, #e6e6e6)", padding: 8 }}>
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
  border: "1px solid var(--border, #222428)",
  borderRadius: "8px",
  padding: "16px",
  overflowY: "auto",      // <-- For scrollable widgets
  background: "var(--surface, #0b0b0b)",
  color: "var(--text, #e6e6e6)"
};

