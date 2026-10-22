import {useCallback,useEffect,useState} from 'react';
import CaptainChangeForm from './CaptainChangeForm';

async function request(url,options) {
  const response=await fetch(url,options);
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Request failed');
  return data;
}
const rowKey=team=>team.EntryId!=null?`entry:${team.EntryId}`:`team:${team.TeamId}`;

export default function CurrentLeagueTeams({data,refreshKey,onTeamUpdated}) {
  const [teams,setTeams]=useState([]),[drafts,setDrafts]=useState({}),[selected,setSelected]=useState('');
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[captainBusy,setCaptainBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const load=useCallback(async(resetKey=null)=>{
    const result=await request('/api/admin/currentLeagueTeams');
    const rows=result.result||[];
    setTeams(rows);
    setDrafts(current=>Object.fromEntries(rows.map(team=>{
      const key=rowKey(team),previous=key===resetKey?null:current[key];
      const savedTeamId=String(team.TeamId??''),savedTeamName=team.TeamName||'';
      return [key,{savedTeamId,savedTeamName,
        teamId:previous&&previous.teamId!==previous.savedTeamId?previous.teamId:savedTeamId,
        teamName:previous&&previous.teamName!==previous.savedTeamName?previous.teamName:savedTeamName}];
    })));
  },[]);
  useEffect(()=>{
    let active=true;setError('');
    load().catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[load,refreshKey]);

  const team=teams.find(t=>rowKey(t)===selected)||teams[0];
  const key=team?rowKey(team):'';
  const draft=drafts[key]||{teamId:'',teamName:''};
  const rosterTeam=data.teams.find(t=>team?.TeamSubmissionId!=null?t.teamKey===team.TeamSubmissionId:
    team?.TeamId!=null&&t.teamId===team.TeamId);
  const busy=saving||captainBusy;
  const changed=Boolean(team)&&(draft.teamId!==String(team.TeamId??'')||draft.teamName.trim()!==team.TeamName);
  const edit=(field,value)=>{
    setDrafts(current=>({...current,[key]:{...current[key],[field]:value}}));setMessage('');setError('');
  };
  async function save(event) {
    event.preventDefault();if(!team||busy||!changed)return;
    if(!draft.teamName.trim()){setError('Team name is required.');return;}
    if(!(team.EntryId!=null&&draft.teamId==='')&&(!/^[1-9]\d*$/.test(draft.teamId)||!Number.isSafeInteger(Number(draft.teamId)))) {
      setError('Enter a positive whole-number team ID.');return;
    }
    setSaving(true);setError('');setMessage('');
    try {
      await request('/api/admin/leagueTeam',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({entryId:team.EntryId,originalTeamId:team.TeamId,
          teamId:draft.teamId===''?null:Number(draft.teamId),teamName:draft.teamName.trim(),groupId:team.GroupId??null}),
      });
      setSelected(team.EntryId!=null?key:`team:${Number(draft.teamId)}`);
      await load(key);setMessage('Team details saved.');onTeamUpdated?.();
    }catch(err){setError(err.message);}finally{setSaving(false);}
  }

  return <section className="betting-admin-widget roster-team-details-card">
    <h3>Team details</h3>
    <p>Choose a team to edit its name, Dota team ID, or captain.</p>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {loading?<p>Loading teams…</p>:!team?<p>No teams are available yet.</p>:<>
      <label>Team<select disabled={busy} value={key} onChange={event=>{setSelected(event.target.value);setMessage('');setError('');}}>
        {teams.map(t=><option key={rowKey(t)} value={rowKey(t)}>{t.TeamName}</option>)}</select></label>
      <form className="roster-team-details-form" onSubmit={save}>
        <label>Team name<input required maxLength="60" disabled={busy} value={draft.teamName}
          onChange={event=>edit('teamName',event.target.value)} /></label>
        <label>Dota team ID<input type="text" inputMode="numeric" pattern="[0-9]*" required={team.EntryId==null} disabled={busy}
          value={draft.teamId} placeholder={team.EntryId!=null?'Not linked yet':''} onChange={event=>edit('teamId',event.target.value)} /></label>
        <button disabled={busy||!changed}>{saving?'Saving…':'Save team details'}</button>
      </form>
      {rosterTeam?<CaptainChangeForm key={rosterTeam.teamKey} data={data} teamKey={rosterTeam.teamKey} disabled={saving}
        onBusyChange={setCaptainBusy} onChanged={onTeamUpdated} />:<p className="roster-team-details-note">A registered roster is needed to assign a captain.</p>}
    </>}
  </section>;
}
