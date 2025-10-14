import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

export default function CurrentLeagueSeries({ seriesList }) {

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch match data on mount
  useEffect(() => {
    async function fetchMatches() {
      setLoading(true);
      try {
        const res = await fetch('/api/currentLeaderboard');
        const data = await res.json();4
        console.log(data);
        setGroups(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchMatches();
  }, []);

    return (
    <div className="flex flex-wrap gap-4 justify-center">
        {groups.map(group => (
        <div
            key={group.GroupId}
            className="border rounded p-3 w-full sm:w-[48%] lg:w-[45%] xl:w-[30%]"
        >
            <h3 className="font-semibold mb-2 text-center">
            {group.GroupName ? group.GroupName : `Group ${group.GroupId}`}
            </h3>

            <table style={tableStyle}>
            <thead>
                <tr className="bg-gray-100">
                <th style={thStyle}>Team</th>
                <th style={thStyle}>Wins</th>
                <th style={thStyle}>Losses</th>
                </tr>
            </thead>
            <tbody>
                {group.groupTeams.map(team => (
                <tr key={team.TeamId}>
                    <td style={tdStyle}>{team.TeamName}</td>
                    <td style={tdStyle}>{team.Wins}</td>
                    <td style={tdStyle}>{team.Losses}</td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>
        ))}
    </div>
    );

}

const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "900px" };
const thStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };
const tdStyle = { border: "1px solid #ccc", padding: "8px", textAlign: "center" };