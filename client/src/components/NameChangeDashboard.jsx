import {useState} from 'react';
import {useAuth} from '../context/AuthContext';

export default function NameChangeDashboard({currentName='',nextNameChangeAt,onChanged}) {
  const {user}=useAuth();
  const [newName,setNewName]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [cooldown,setCooldown]=useState(null);
  const next=cooldown||nextNameChangeAt;
  const locked=next&&Date.parse(next)>Date.now();
  async function save(event) {
    event.preventDefault();
    if(!user||busy||locked||!newName.trim()||newName.trim()===currentName)return;
    if(!window.confirm(`You can only change your league name once every 30 days.\n\nChange it to "${newName.trim()}"?`))return;
    setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/nameChange',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({newName:newName.trim()})});
      const result=await response.json();
      if(!response.ok){if(result.nextNameChangeAt)setCooldown(result.nextNameChangeAt);throw Error(result.error||'Unable to update your league name');}
      setCooldown(result.nextNameChangeAt);setNewName('');setMessage('Your league name has been updated.');onChanged?.(result);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  return <form className="player-dashboard-name-form" onSubmit={save}>
    <label htmlFor="dashboard-new-name">New league name</label>
    <div><input id="dashboard-new-name" type="text" required maxLength="40" autoComplete="nickname" value={newName}
      onChange={event=>setNewName(event.target.value)} placeholder={currentName||'Enter your league name'} disabled={busy||locked} />
      <button type="submit" disabled={!user||busy||locked||!newName.trim()||newName.trim()===currentName}>{busy?'Saving…':'Save name'}</button></div>
    <small>{locked?`Next change available ${new Date(next).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}.`:'You can change your league name once every 30 days.'}</small>
    {message&&<p role="status" className="player-dashboard-success">{message}</p>}{error&&<p role="alert" className="player-dashboard-error">{error}</p>}
  </form>;
}
