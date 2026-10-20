import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import GroupQualificationEditor from './GroupQualificationEditor';
import './LeagueSetupTable.css';

async function request(options={}) {
  const response=await fetch('/api/admin/leagueSetup',{cache:'no-store',...options});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error||'Could not load league groups'),{status:response.status});
  return data;
}
const teamKey=team=>team.EntryId!=null?`entry:${team.EntryId}`:`team:${team.TeamId}`;
function beginDraft(board) {
  return {leagueId:board.league.LeagueId,leagueName:board.league.LeagueName,revision:board.revision,
    groups:board.groups.map(g=>({id:g.GroupId,name:g.GroupName})),
    teams:[...board.groups.flatMap(g=>g.teams.map(t=>({key:teamKey(t),name:t.TeamName,teamId:t.TeamId??null,
      groupId:g.GroupId,submissionId:t.TeamSubmissionId,editable:t.EntryId!=null&&t.TeamId==null}))),
      ...board.availableTeams.map(t=>({key:teamKey(t),name:t.TeamName||`Team ${t.TeamId}`,teamId:t.TeamId,groupId:null,editable:false})),
      ...(board.unregisteredTeams||[]).map(t=>({key:`submission:${t.TeamSubmissionId}`,name:t.TeamName,teamId:t.TeamId??null,
        groupId:null,submissionId:t.HasRoster?t.TeamSubmissionId:null,editable:true,unregistered:true}))]};
}
const payload=draft=>({leagueId:draft.leagueId,revision:draft.revision,
  groups:draft.groups.map(({id,name})=>({id,name})),teams:draft.teams.map(({key,name,teamId,groupId})=>({key,name,teamId,groupId}))});

function TeamPlayers({teamKey}) {
  const [result,setResult]=useState(null),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/admin/leagueSetup/players?team=${encodeURIComponent(teamKey)}`,{signal:controller.signal,cache:'no-store'})
      .then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load players');return data.players;})
      .then(players=>{if(!controller.signal.aborted)setResult({teamKey,attempt,players});})
      .catch(error=>{if(!controller.signal.aborted)setResult({teamKey,attempt,error:error.message});});
    return()=>controller.abort();
  },[teamKey,attempt]);
  if(result?.teamKey!==teamKey||result?.attempt!==attempt)return <small role="status">Loading players…</small>;
  if(result.error)return <small role="alert">{result.error} <button type="button" onClick={()=>setAttempt(value=>value+1)}>Retry</button></small>;
  return result.players.length?<ul className="league-setup-player-list">{result.players.map((player,index)=><li key={player.PlayerId??`pending:${index}`}>{player.PlayerName}</li>)}</ul>
    :<small>No roster recorded.</small>;
}

export default function LeagueSetupTable({refreshKey,onUpdated}) {
  const [snapshot,setSnapshot]=useState(null),[draft,setDraft]=useState(null),[newGroupName,setNewGroupName]=useState('');
  const [newTeamNames,setNewTeamNames]=useState({}),[dragged,setDragged]=useState(null);
  const [expandedTeams,setExpandedTeams]=useState({});
  const [editingRules,setEditingRules]=useState(false);
  const [loadError,setLoadError]=useState(''),[saveError,setSaveError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const mounted=useRef(false),pending=useRef(null),serial=useRef(0),savingRef=useRef(false),initialDraft=useRef('');
  const load=useCallback(async()=>{
    if(pending.current||savingRef.current)return;
    const controller=new AbortController(),version=++serial.current;pending.current=controller;
    try {
      const result=await request({signal:controller.signal});
      if(mounted.current&&version===serial.current){setSnapshot(result);setLoadError('');}
    }catch(error){if(mounted.current&&!controller.signal.aborted)setLoadError(error.message);}
    finally{if(pending.current===controller)pending.current=null;}
  },[]);
  useEffect(()=>{
    mounted.current=true;load();
    const refresh=()=>{if(document.visibilityState==='visible')load();};
    const timer=setInterval(refresh,1000);document.addEventListener('visibilitychange',refresh);
    return()=>{mounted.current=false;pending.current?.abort();pending.current=null;
      clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[load,refreshKey]);

  const editing=Boolean(draft),board=draft||(snapshot?.league?beginDraft(snapshot):null);
  const conflict=editing&&snapshot?.revision!==draft.revision;
  const changed=editing&&JSON.stringify(payload(draft))!==initialDraft.current;
  const blocker=editing&&(draft.groups.some(g=>!g.name.trim())?'Every group needs a name.':
    draft.teams.some(t=>(t.key.startsWith('entry:')||t.key.startsWith('new-team:'))&&t.groupId===null)?'Assign every signup or named team to a group before saving.':
    draft.teams.some(t=>t.unregistered&&t.teamId!==null&&t.groupId===null)?'Assign an unregistered team to a group before linking a team ID.':'');
  const canEdit=editing&&!saving;
  const updateTeam=(key,patch)=>setDraft(current=>({...current,teams:current.teams.map(t=>t.key===key?{...t,...patch}:t)}));
  const move=(key,groupId)=>{
    if(!canEdit)return;
    setDraft(current=>{const team=current.teams.find(t=>t.key===key);return team?{...current,
      teams:[...current.teams.filter(t=>t.key!==key),{...team,groupId}]}:current;});setDragged(null);
  };
  const drop=(event,groupId)=>{event.preventDefault();const key=dragged||event.dataTransfer.getData('text/plain');if(key)move(key,groupId);};
  const cancel=()=>{setDraft(null);setNewGroupName('');setNewTeamNames({});setSaveError('');setDragged(null);};
  async function save() {
    if(!draft||saving||conflict||blocker||!changed)return;
    savingRef.current=true;setSaving(true);setSaveError('');serial.current++;pending.current?.abort();pending.current=null;
    try {
      const result=await request({method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(draft))});
      if(!mounted.current)return;
      setSnapshot(result);cancel();setMessage('Group setup saved.');onUpdated?.();
    }catch(error){if(mounted.current){setSaveError(error.message);if(error.status===409){savingRef.current=false;await load();}}}
    finally{savingRef.current=false;if(mounted.current)setSaving(false);}
  }
  const claimedIds=new Set(board?.teams.filter(t=>t.editable&&t.teamId!==null).map(t=>t.teamId));
  const visibleTeams=board?.teams.filter(t=>!(t.key.startsWith('team:')&&t.groupId===null&&claimedIds.has(t.teamId)))||[];
  const unassigned=visibleTeams.filter(t=>t.groupId===null);
  const columns=board?[...(unassigned.length||!board.groups.length?[{id:null,name:unassigned.some(t=>t.unregistered)?'Unassigned / unregistered':'Unassigned'}]:[]),...board.groups]:[];
  return <section className="league-setup-widget" aria-label="League group setup">
    <div className="league-setup-heading"><div><h2>Initial group setup</h2>
      <p>{board?.leagueName||'League groups'} · {editing?'Editing draft':'Locked'}</p></div>
      <div className="league-setup-actions">{editing?<>
        <button type="button" className="ui-button-primary" disabled={saving||conflict||Boolean(blocker)||!changed} onClick={save}>{saving?'Saving…':'Save groups'}</button>
        <button type="button" disabled={saving} onClick={cancel}>Cancel</button>
      </>:<><button type="button" disabled={!snapshot?.league||editingRules} onClick={()=>{
        const next=beginDraft(snapshot);initialDraft.current=JSON.stringify(payload(next));setDraft(next);setMessage('');setSaveError('');
      }}>Edit groups</button><button type="button" disabled={!snapshot?.league} onClick={()=>setEditingRules(value=>!value)}>{editingRules?'Hide rules':'Edit rules'}</button></>}</div>
    </div>
    {loadError&&<p className="league-setup-error" role="alert">{loadError} <button type="button" onClick={load}>Retry</button></p>}
    {saveError&&<p className="league-setup-error" role="alert">{saveError}</p>}
    {conflict&&<p className="league-setup-conflict" role="alert">Another admin or league update changed the saved groups. Your draft is still here. Cancel editing to load the latest version.</p>}
    {message&&<p className="league-setup-message" role="status">{message}</p>}
    {editingRules&&snapshot?.league&&<GroupQualificationEditor leagueId={snapshot.league.LeagueId} groups={snapshot.groups} onSaved={onUpdated}/>}
    {!editingRules&&(!snapshot?<p>Loading groups…</p>:!snapshot.league&&!editing?<p>No active league.</p>:<>
      <p className="league-setup-hint">{editing?'Drag teams between groups, or use their group dropdown. Removing a team also deletes its signup and roster. Changes apply when you save.':'Click Edit groups to make changes. Saved changes from other admins appear automatically.'}</p>
      {editing&&<form className="league-setup-add-group" onSubmit={event=>{
        event.preventDefault();const name=newGroupName.trim();if(!name)return;
        setDraft(current=>({...current,groups:[...current.groups,{id:`new-group:${crypto.randomUUID()}`,name}]}));setNewGroupName('');
      }}><label htmlFor="league-setup-new-group">Add group</label>
        <input id="league-setup-new-group" required maxLength={60} value={newGroupName} placeholder="Group name" disabled={saving} onChange={event=>setNewGroupName(event.target.value)} />
        <button type="submit" disabled={saving||!newGroupName.trim()}>Add group</button>
      </form>}
      {blocker&&<p className="league-setup-hint" role="status">{blocker}</p>}
      {editing&&!unassigned.length&&board.groups.length>0&&<div className="league-setup-unassigned-drop"
        onDragOver={event=>{if(canEdit)event.preventDefault();}} onDrop={event=>drop(event,null)}>Unassigned (0) · Drop a team here to unassign it</div>}
      <div className="league-setup-board">{columns.map(group=><section key={group.id??'unassigned'} className={`league-setup-column${group.id===null?' is-unassigned':''}`}
        onDragOver={event=>{if(canEdit)event.preventDefault();}} onDrop={event=>drop(event,group.id)}>
        <div className="league-setup-column-heading">{editing&&group.id!==null?<input aria-label={`Name for group ${group.id}`} maxLength={60}
          value={group.name} disabled={saving} onChange={event=>setDraft(current=>({...current,groups:current.groups.map(g=>g.id===group.id?{...g,name:event.target.value}:g)}))} />
          :<h3>{group.name}</h3>}<small>{visibleTeams.filter(t=>t.groupId===group.id).length} teams</small>
          {editing&&typeof group.id==='string'&&!visibleTeams.some(t=>t.groupId===group.id)&&<button type="button" disabled={saving}
            onClick={()=>setDraft(current=>({...current,groups:current.groups.filter(g=>g.id!==group.id)}))}>Remove</button>}
        </div>
        <div className="league-setup-team-list">{visibleTeams.filter(t=>t.groupId===group.id).map(team=>{
          const candidates=(snapshot?.availableTeams||[]).filter(t=>t.TeamId===team.teamId||!claimedIds.has(t.TeamId));
          const href=team.teamId?`/team/${team.teamId}`:team.submissionId?`/team/roster/${team.submissionId}`:null;
          const rosterKey=`${board.leagueId}:${team.key}`,playersOpen=Boolean(expandedTeams[rosterKey]);
          return <div key={team.key} className="league-setup-team-card" draggable={canEdit} onDragStart={event=>{
            if(!canEdit||event.target.closest('input,select,button,a,summary')){event.preventDefault();return;}
            event.dataTransfer.setData('text/plain',team.key);setDragged(team.key);
          }} onDragEnd={()=>setDragged(null)}>
            <strong title={team.name}>{href?<Link to={href} target="_blank" rel="noopener noreferrer" draggable={false}>{team.name}</Link>:team.name}</strong>
            <small>{team.unregistered?'Awaiting group assignment':team.teamId?`Team ID ${team.teamId}`:'Awaiting Team ID'}</small>
            {!team.key.startsWith('new-team:')&&<div className="league-setup-players">
              <button type="button" className="league-setup-players-toggle" aria-expanded={playersOpen}
                aria-label={`${playersOpen?'Hide':'Show'} players for ${team.name}`}
                onClick={()=>setExpandedTeams(current=>({...current,[rosterKey]:!playersOpen}))}>Players <span aria-hidden="true">{playersOpen?'▴':'▾'}</span></button>
              {playersOpen&&<TeamPlayers key={rosterKey} teamKey={team.key} />}
            </div>}
            {editing&&<select aria-label={`Group for ${team.name}`} value={team.groupId??''} disabled={saving} onChange={event=>{
              move(team.key,event.target.value?board.groups.find(g=>String(g.id)===event.target.value).id:null);
            }}><option value="">Unassigned</option>{board.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
            {editing&&team.editable&&<details className="league-setup-team-details"><summary>Edit team</summary>
              <label>Team name<input maxLength={60} value={team.name} disabled={saving} onChange={event=>updateTeam(team.key,{name:event.target.value})} /></label>
              {candidates.length>0&&<label>Link played team ID<select value={team.teamId??''} disabled={saving}
                onChange={event=>updateTeam(team.key,{teamId:event.target.value?Number(event.target.value):null})}>
                <option value="">Awaiting Team ID</option>{candidates.map(t=><option key={t.TeamId} value={t.TeamId}>{t.TeamName||'Unknown team'} ({t.TeamId})</option>)}
              </select></label>}
              <button type="button" className="ui-button-danger" disabled={saving}
                onClick={()=>setDraft(current=>({...current,teams:current.teams.filter(t=>t.key!==team.key)}))}>Remove team</button>
            </details>}
          </div>;
        })}</div>
        {editing&&group.id!==null&&<form className="league-setup-new-team" onSubmit={event=>{
          event.preventDefault();const name=(newTeamNames[group.id]||'').trim();if(!name)return;
          setDraft(current=>({...current,teams:[...current.teams,{key:`new-team:${crypto.randomUUID()}`,name,teamId:null,groupId:group.id,editable:true}]}));
          setNewTeamNames(current=>({...current,[group.id]:''}));
        }}><input aria-label={`Add team to ${group.name}`} placeholder="Add team name" maxLength={60} required disabled={saving}
          value={newTeamNames[group.id]||''} onChange={event=>setNewTeamNames(current=>({...current,[group.id]:event.target.value}))} />
          <button type="submit" disabled={saving||!(newTeamNames[group.id]||'').trim()}>Add team</button></form>}
      </section>)}</div>
    </>)}
  </section>;
}
