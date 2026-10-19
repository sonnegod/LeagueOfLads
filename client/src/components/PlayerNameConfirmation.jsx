import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import './PlayerNameConfirmation.css';

export default function PlayerNameConfirmation() {
  const {user,setUser}=useAuth();
  const name=user?.leagueName||user?.personaname||'';
  const [editing,setEditing]=useState(!name.trim()||name.trim().length>40);
  const [value,setValue]=useState(name),[dismissed,setDismissed]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[serverCooldown,setServerCooldown]=useState(null);
  const dialogRef=useRef(null),inputRef=useRef(null);
  const visible=Boolean(user?.nameConfirmation?.required)&&!dismissed;
  const next=serverCooldown||user?.nameConfirmation?.nextNameChangeAt;
  const locked=next&&Date.parse(next)>Date.now();
  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!visible||!dialog)return;
    if(!dialog.open)dialog.showModal();
    return()=>{if(dialog.open)dialog.close();};
  },[visible]);
  useEffect(()=>{if(editing&&visible)inputRef.current?.focus();},[editing,visible]);
  async function confirm(event) {
    event.preventDefault();if(busy)return;
    const selected=editing?value.trim():name.trim();
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/auth/confirm-player-name',{method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({name:selected})});
      const result=await response.json();
      if(!response.ok){if(result.nextNameChangeAt)setServerCooldown(result.nextNameChangeAt);throw Error(result.error||'Unable to confirm your league name');}
      setUser(current=>current?{...current,leagueName:result.name,nameConfirmation:{...current.nameConfirmation,
        required:false,confirmedAtUtc:result.confirmedAtUtc,nextNameChangeAt:result.nextNameChangeAt}}:current);
    }catch(err){setError(err.message);}finally{setBusy(false);}
  }
  if(!visible)return null;
  return <dialog ref={dialogRef} className="player-name-confirmation" aria-labelledby="player-name-confirmation-title"
    aria-describedby="player-name-confirmation-description" onCancel={event=>{event.preventDefault();if(!busy)setDismissed(true);}}>
    <form onSubmit={confirm}>
      <p className="player-name-confirmation-welcome">Welcome to League of Lads</p>
      <h2 id="player-name-confirmation-title">Is this your league name?</h2>
      <p id="player-name-confirmation-description">{user.leagueName?'We have you recorded as:':'We’ve started with your Steam name:'}</p>
      <p className="player-name-confirmation-name">{name||'Choose your league name'}</p>
      <p>This is the name shown on league pages. Your Steam name stays the same.</p>
      {editing&&<div className="player-name-confirmation-input"><label htmlFor="first-login-league-name">Your league name</label>
        <input ref={inputRef} id="first-login-league-name" required maxLength={40} autoComplete="nickname" value={value}
          onChange={event=>setValue(event.target.value)} disabled={busy||locked} />
      </div>}
      <p className="player-name-confirmation-note">{locked?
        `You can keep this name now. Your next name change is available ${new Date(next).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}.`:
        'You can change your league name once every 30 days from your dashboard.'}</p>
      {error&&<p className="player-name-confirmation-error" role="alert">{error}</p>}
      <div className="player-name-confirmation-actions">
        <button type="submit" className="player-name-confirmation-primary" disabled={busy||(editing&&(!value.trim()||(locked&&value.trim()!==name.trim())))}>
          {busy?'Saving…':editing?'Confirm name':'Yes, keep this name'}</button>
        {editing?<button type="button" disabled={busy||!name.trim()||name.trim().length>40} onClick={()=>{setEditing(false);setError('');}}>Keep current name</button>
          :<button type="button" disabled={busy||locked} onClick={()=>{setValue(name);setEditing(true);}}>Choose another name</button>}
      </div>
      <button type="button" className="player-name-confirmation-later" disabled={busy} onClick={()=>setDismissed(true)}>I’ll do this later</button>
    </form>
  </dialog>;
}
