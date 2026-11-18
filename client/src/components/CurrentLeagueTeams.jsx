import {useCallback,useEffect,useState} from 'react';
import RosterOrderCard from './RosterOrderCard';

async function request(url,options) {
  const response=await fetch(url,options);
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Request failed');
  return data;
}
const rowKey=team=>team.RosterOnly?`signup:${team.TeamSubmissionId}`:team.EntryId!=null?`entry:${team.EntryId}`:`team:${team.TeamId}`;

export default function CurrentLeagueTeams({data,refreshKey,onTeamUpdated}) {
  const [teams,setTeams]=useState([]),[drafts,setDrafts]=useState({}),[selected,setSelected]=useState('');
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [orderBusy,setOrderBusy]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const preseason=data.season.status==='signup_closed';
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
    if(preseason){setLoading(false);return;}
    let active=true;setError('');
    load().catch(err=>{if(active)setError(err.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[load,refreshKey,preseason]);

  const publishedTeams=preseason?[]:teams;
  const availableTeams=[...publishedTeams,...data.teams.filter(t=>!publishedTeams.some(row=>row.TeamSubmissionId===t.teamKey
    ||t.teamId!=null&&row.TeamId===t.teamId)).map(t=>({RosterOnly:true,TeamSubmissionId:t.teamKey,TeamId:t.teamId,TeamName:t.name}))];
  const team=availableTeams.find(t=>rowKey(t)===selected)||availableTeams[0];
  const key=team?rowKey(team):'';
  const draft=drafts[key]||{teamId:'',teamName:''};
  const rosterTeam=data.teams.find(t=>team?.TeamSubmissionId!=null?t.teamKey===team.TeamSubmissionId:
    team?.TeamId!=null&&t.teamId===team.TeamId);
  const busy=saving||orderBusy;
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
    <h3>Team details &amp; roster</h3>
    {error&&<p role="alert" className="sportsbook-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {loading?<p>Loading teams…</p>:!team?<p>No teams are available yet.</p>:<>
      <label>Team<select disabled={busy} value={key} onChange={event=>{setSelected(event.target.value);setMessage('');setError('');}}>
        {availableTeams.map(t=><option key={rowKey(t)} value={rowKey(t)}>{t.TeamName}</option>)}</select></label>
      <div className="roster-team-editor-fields">
      {rosterTeam?<RosterOrderCard key={rosterTeam.teamKey} data={data} teamKey={rosterTeam.teamKey}
        disabled={saving} onBusyChange={setOrderBusy} onChanged={onTeamUpdated} />
        :<p className="roster-team-details-note">A registered roster is needed to set player positions.</p>}
      <div className="roster-team-editor-details">
      <h4>Team details</h4>
      {team.RosterOnly?<p className="roster-team-details-note">Team name and Dota ID can be edited here after the team is published to league groups.</p>:<form className="roster-team-details-form" onSubmit={save}>
        <label>Team name<input required maxLength="60" disabled={busy} value={draft.teamName}
          onChange={event=>edit('teamName',event.target.value)} /></label>
        <label>Dota team ID<input type="text" inputMode="numeric" pattern="[0-9]*" required={team.EntryId==null} disabled={busy}
          value={draft.teamId} placeholder={team.EntryId!=null?'Not linked yet':''} onChange={event=>edit('teamId',event.target.value)} /></label>
        <button disabled={busy||!changed}>{saving?'Saving…':'Save team details'}</button>
      </form>}
      </div></div>
    </>}
  </section>;
}
