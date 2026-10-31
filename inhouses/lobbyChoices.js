export function lobbyChoices(game) {
  const pending = game.ChoiceTurn < 2;
  const firstSide = game.ChoiceCaptain === game.CaptainA ? 'A' : 'B';
  const side = game.ChoiceTurn === 0 ? firstSide : firstSide === 'A' ? 'B' : 'A';
  const kind = game.GameMode !== 2 || game.ChoiceTurn > 0 && !game.LobbyRadiantSide ? 'side'
    : game.ChoiceTurn === 0 ? 'either' : 'pick';
  return {pending, turn: game.ChoiceTurn, firstCaptainId: game.ChoiceCaptain,
    captainId: pending ? side === 'A' ? game.CaptainA : game.CaptainB : null,
    kind, deadline: pending ? game.ChoiceDeadline : null,
    radiantSide: game.LobbyRadiantSide, firstPickSide: game.FirstPickSide,
    options: !pending ? [] : kind === 'side' ? ['radiant','dire'] : kind === 'pick' ? ['first_pick','second_pick']
      : ['radiant','dire','first_pick','second_pick']};
}
