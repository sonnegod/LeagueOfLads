export default function InhouseRoleFields({roles, offRole, onRolesChange, onOffRoleChange, disabled}) {
  function move(index, direction) {
    const next = [...roles];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onRolesChange(next);
  }
  return <fieldset disabled={disabled}>
    <legend>Preferred positions · best first</legend>
    <div className="inhouse-role-choices">{[1, 2, 3, 4, 5].map(role => <button key={role} type="button" aria-pressed={roles.includes(role)}
      onClick={() => onRolesChange(roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role])}>Pos {role}</button>)}</div>
    {roles.length ? <ol className="inhouse-role-order">{roles.map((role, index) => <li key={role}><span>Position {role}</span>
      <button type="button" aria-label={`Move position ${role} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
      <button type="button" aria-label={`Move position ${role} down`} disabled={index === roles.length - 1} onClick={() => move(index, 1)}>↓</button></li>)}</ol>
      : <p className="inhouse-muted">No position preference.</p>}
    <label className="inhouse-check"><input type="checkbox" checked={offRole} onChange={event => onOffRoleChange(event.target.checked)} />Accept other positions</label>
    {!roles.length && !offRole && <p className="inhouse-role-error">Select a position or accept other positions.</p>}
  </fieldset>;
}
