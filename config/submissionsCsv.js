function cell(value) {
  const raw = String(value ?? '');
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function submissionsCsv(teams) {
  const columns = [
    'Submission ID', 'Type', 'Team name', 'Captain name', 'Captain account ID',
    'Team average MMR', 'Submitted at (UTC)', 'Last updated (UTC)',
  ];
  for (let slot = 1; slot <= 5; slot += 1) {
    columns.push(`Player ${slot} name`, `Player ${slot} account ID`,
      `Player ${slot} MMR`, `Player ${slot} Dotabuff URL`);
  }

  const rows = teams.map(team => {
    const values = [team.TeamSubmissionId, team.IsManual ? 'Manual' : 'Signup',
      team.TeamName, team.CaptainName, team.CaptainId, team.AverageMMR,
      team.SubmittedAt, team.UpdatedAt];
    for (let slot = 0; slot < 5; slot += 1) {
      const player = team.players?.find(entry => entry.Slot === slot);
      values.push(player?.PlayerName, player?.PlayerId, player?.MMR, player?.DotaProfileUrl);
    }
    return values;
  });

  return `\uFEFF${[columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
