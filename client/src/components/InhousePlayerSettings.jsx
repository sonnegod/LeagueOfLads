import {useState} from 'react';
import InhouseRoleFields from './InhouseRoleFields';

export default function InhousePlayerSettings({profile, reserved, busy, run}) {
  const [roles, setRoles] = useState(profile.roles), [offRole, setOffRole] = useState(profile.offRole), [saved, setSaved] = useState(false);
  async function save(event) {
    event.preventDefault();
    if (await run('/inhouses/preferences', 'PUT', {roles, offRole})) setSaved(true);
  }
  return <section className="inhouse-card inhouse-player-settings"><h2>Role preferences</h2>
    <p className="inhouse-muted">Select your preferred positions, then put them in order. Leave the list empty and accept other positions to fill any role.</p>
    <form onSubmit={save} className="inhouse-preferences">
      <InhouseRoleFields roles={roles} offRole={offRole} onRolesChange={value => {setRoles(value); setSaved(false);}}
        onOffRoleChange={value => {setOffRole(value); setSaved(false);}} disabled={busy || reserved} />
      {reserved ? <p>Your preferences are locked until your current inhouse completes or is cancelled.</p>
        : <div><button className="inhouse-primary" type="submit" disabled={busy || !roles.length && !offRole}>Save preferences</button></div>}
      {saved && <p role="status">Preferences saved.</p>}
    </form>
  </section>;
}
