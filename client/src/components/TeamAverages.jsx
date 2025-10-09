import React from 'react';

export default function AverageStatsTab({ averages }) {
  if (!averages) return <div>No averages available</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th>Stat</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(averages).map(([stat, value]) => (
          <tr key={stat}>
            <td>{stat}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
