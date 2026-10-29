import {useEffect, useRef, useState} from 'react';
import InhouseRoleFields from './InhouseRoleFields';

export default function InhouseRoleWelcome({profile, run, busy}) {
  const dialog = useRef(null), [roles, setRoles] = useState(profile.roles), [offRole, setOffRole] = useState(profile.offRole);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    function show() {
      if (element && !element.open && !document.querySelector('dialog[open]')) element.showModal();
    }
    // Let the existing name-confirmation dialog open first. If it is visible,
    // wait until it closes rather than stacking two first-visit prompts.
    const timer = setTimeout(show, 0);
    const observer = new MutationObserver(show);
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['open']});
    return () => {clearTimeout(timer); observer.disconnect(); if (element?.open) element.close();};
  }, []);
  async function skip() {
    if (busy) return;
    setError('');
    if (!await run('/inhouses/preferences/dismiss', 'POST')) setError('Could not save your choice. Please try again.');
  }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    setError('');
    if (!await run('/inhouses/preferences', 'PUT', {roles, offRole})) setError('Could not save your preferences. Please try again.');
  }
  return <dialog ref={dialog} className="inhouse-role-dialog" aria-labelledby="inhouse-role-welcome-title" aria-describedby="inhouse-role-welcome-description"
    onCancel={event => {event.preventDefault(); skip();}}>
    <form className="inhouse-preferences" onSubmit={save}>
      <div><p className="inhouse-eyebrow">Welcome to inhouses</p><h2 id="inhouse-role-welcome-title">Where do you like to play?</h2>
        <p id="inhouse-role-welcome-description">Set your role preferences now, or skip and choose them later in Player Settings.</p></div>
      <InhouseRoleFields roles={roles} offRole={offRole} onRolesChange={setRoles} onOffRoleChange={setOffRole} disabled={busy} />
      {error && <p role="alert" className="inhouse-role-error">{error}</p>}
      <div className="inhouse-actions"><button className="inhouse-primary" type="submit" disabled={busy || !roles.length && !offRole}>Save preferences</button>
        <button type="button" disabled={busy} onClick={skip}>Skip for now</button></div>
    </form>
  </dialog>;
}
