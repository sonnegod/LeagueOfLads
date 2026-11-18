import { useState, useEffect, useId, useRef } from "react";
import { Link } from 'react-router-dom';
import MatchRecordBrowser from './MatchRecordBrowser';
import './MatchEditorPanel.css';
import {matchRecordDay} from '../../../shared/matchRecordDay.js';

export default function MatchEditorPanel({ onMatchUpdated, leagueId, refreshKey }) {
  const formId=useId();
  const detail=useRef(null),browser=useRef(null);
  const isEditorStacked=()=>detail.current&&browser.current&&Math.abs(detail.current.getBoundingClientRect().left-browser.current.getBoundingClientRect().left)<2;
  const [revision,setRevision]=useState(0);
  const [matchId, setMatchId] = useState("");
  const [teamList, setTeamList] = useState([]);

  const [team1, setTeam1] = useState("");
  const [team2, setTeam2] = useState("");
  const [winner, setWinner] = useState("");

  const [original, setOriginal] = useState(null);

  const [busy, setBusy] = useState('');
  const loading=Boolean(busy);
  const [message, setMessage] = useState("");

  // ---------------------------------------------------------
  // Load full list of teams (used for dropdowns)
  // ---------------------------------------------------------
  useEffect(() => {
    const controller=new AbortController();
    fetch(`/api/admin/recordTeams${leagueId?`?leagueId=${leagueId}`:''}`,{signal:controller.signal})
      .then(async res => {const data=await res.json();if(!res.ok)throw new Error(data.error||'Error loading teams');return data;})
      .then(data => setTeamList(data.teams||[]))
      .catch(err => {if(err.name!=='AbortError')setMessage(err.message);});
    return()=>controller.abort();
  }, [leagueId,refreshKey,revision]);

  // ---------------------------------------------------------
  // Load match data by ID
  // ---------------------------------------------------------
  const loadMatch = async (requestedId=matchId,record=null) => {
    const text=String(requestedId).trim();
    const id=/^\d+$/.test(text)?text:text.match(/\/(?:match|matches)\/(\d+)(?:[/?#]|$)/)?.[1];
    if (!id) {
        setMessage("Enter a Match ID or match link.");
        return;
    }
    if(original&&(team1!==original.team1||team2!==original.team2||winner!==original.winner)
      &&!window.confirm('Discard your unsaved match changes and load this game?'))return;

    setMatchId(id);
    setBusy('load');
    setOriginal(null);
    setMessage("");

    try {
        const res = await fetch(`/api/matchEdit/${encodeURIComponent(id)}${leagueId?`?leagueId=${leagueId}`:''}`);
        const data = await res.json();
        if(!res.ok)throw new Error(data.error||'Error loading match');

        if (!data || Object.keys(data).length === 0) {
        setMessage("Match not found.");
        } else {
        setTeam1(String(data.team1.TeamId ?? ''));
        setTeam2(String(data.team2.TeamId ?? ''));
        setWinner(String(data.winner?.TeamId ?? ''));
        setMessage("Match loaded successfully.");

        //helps check for change
        setOriginal({
            matchId:id,
            playedAt:data.playedAt??record?.playedAt,
            seriesId:data.seriesId??record?.seriesId,
            leagueName:data.league?.LeagueName,
            team1Name:data.team1.TeamName||`Team ${data.team1.TeamId}`,
            team2Name:data.team2.TeamName||`Team ${data.team2.TeamId}`,
            team1: String(data.team1.TeamId),
            team2: String(data.team2.TeamId),
            winner: String(data.winner?.TeamId??''),
        });
        if(isEditorStacked())detail.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
        }
    } catch (err) {
        console.error("Load error:", err);
        setOriginal(null);
        setMessage(err.message||"Error loading match.");
    }

    setBusy('');
  };


  // ---------------------------------------------------------
  // Update match in DB
  // ---------------------------------------------------------
  const updateMatch = async () => {
    if (!original || Number(team1)<=0 || Number(team2)<=0 || team1===team2 || ![team1,team2].includes(winner)) {
      setMessage("Load a match, select two different teams, and select their winner.");
      return;
    }

    if (
        team1 === original.team1 &&
        team2 === original.team2 &&
        winner === original.winner
    ) {
        setMessage("No changes detected.");
        return;
    }

    setBusy('update');
    setMessage("");

    try {
      const res = await fetch("/api/admin/updateMatchTeams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId:original.matchId,
          team1,
          team2,
          winner,

          team1Old: original.team1,
          team2Old: original.team2,
          ...(leagueId?{leagueId}:{}),
        })
      });

      const result = await res.json();

      if (res.ok&&result.success) {
        setMessage("Match updated successfully!");
        
        //need to reset new values
        const details=await fetch(`/api/matchEdit/${encodeURIComponent(original.matchId)}${leagueId?`?leagueId=${leagueId}`:''}`)
          .then(response=>response.ok?response.json():null).catch(()=>null);
        setOriginal(current=>({...current,
            team1,
            team2,
            winner,
            playedAt:details?.playedAt??current.playedAt,
            seriesId:details?details.seriesId:current.seriesId,
            team1Name:details?.team1?.TeamName||teamList.find(t=>String(t.TeamId)===team1)?.TeamName||current.team1Name,
            team2Name:details?.team2?.TeamName||teamList.find(t=>String(t.TeamId)===team2)?.TeamName||current.team2Name,
        }));

        onMatchUpdated && onMatchUpdated();
        setRevision(value=>value+1);
      } else {
        setMessage(result.error||"Update failed.");
      }
    } catch (err) {
      console.error("Update error:", err);
      setMessage("Error updating match.");
    }

    setBusy('');
  };

  const deleteMatch=async()=>{
    if(!original||loading)return;
    const {matchId:id,leagueName,team1Name,team2Name}=original;
    if(!window.confirm(`Delete Match ${id}${leagueName?` from ${leagueName}`:''}?\n${team1Name} vs ${team2Name}\nThis cannot be undone.`))return;
    setBusy('delete');setMessage('');
    try {
      const response=await fetch('/api/admin/deleteMatch',{
        method:'DELETE',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({matchId:id,...(leagueId?{leagueId}:{})}),
      });
      const result=await response.json();
      if(!response.ok||!result.success)throw new Error(result.error||'Delete failed.');
      setOriginal(null);setMatchId('');setTeam1('');setTeam2('');setWinner('');
      setMessage(`Match ${id} deleted successfully.`);
      onMatchUpdated?.();
      setRevision(value=>value+1);
      if(isEditorStacked())browser.current?.scrollIntoView({block:'start'});
    }catch(error){setMessage(error.message||'Error deleting match.');}
    finally{setBusy('');}
  };

  const options=[...teamList];
  if(original)for(const [id,name] of [[original.team1,original.team1Name],[original.team2,original.team2Name]]) {
    if(!options.some(team=>String(team.TeamId)===id))options.push({TeamId:id,TeamName:name});
  }
  const nameFor=id=>options.find(team=>String(team.TeamId)===id)?.TeamName||`Team ${id}`;
  return (
    <section className="match-editor-card" aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`}>Match Editor</h3>
      <div className="match-editor-workspace">
      <div ref={browser} className="match-editor-browser"><MatchRecordBrowser leagueId={leagueId} refreshKey={`${refreshKey}:${revision}`} selectedId={original?.matchId}
        disabled={loading} onSelect={record=>loadMatch(record.matchId,record)} /></div>
      <div ref={detail} className="match-editor-detail">
      <button type="button" className="match-editor-back" onClick={()=>browser.current?.scrollIntoView({block:'start'})}>Back to matches</button>
      <form className="match-editor-load" onSubmit={event=>{event.preventDefault();loadMatch();}}>
      <label htmlFor={`${formId}-match`}>Match ID or link</label>
      <div className="match-editor-id-row">
        <input
          id={`${formId}-match`}
          type="text"
          value={matchId}
          disabled={loading}
          onChange={e => {setMatchId(e.target.value);setOriginal(null);setTeam1('');setTeam2('');setWinner('');setMessage('');}}
          placeholder="Enter match ID or paste a link"
        />
        <button type="submit" disabled={loading}>{busy==='load'?'Loading…':'Load'}</button>
      </div>
      </form>
      {original?<div className="match-editor-context">
        <Link to={`/match/${original.matchId}`}>Match #{original.matchId} ↗</Link>
        <strong>{original.team1Name} vs {original.team2Name}</strong>
        <span>{[original.leagueName,matchRecordDay(original.playedAt),original.seriesId?`Series #${original.seriesId}`:null].filter(Boolean).join(' · ')}</span>
      </div>:<p className="match-editor-empty">Select a game from the list, or load a match by ID.</p>}
      <div className="match-editor-fields">
      <label htmlFor={`${formId}-radiant`}>Radiant team</label>
      <select
        id={`${formId}-radiant`}
        value={team1}
        disabled={loading||!original}
        onChange={e => {const next=e.target.value;if(winner===team1)setWinner(next);setTeam1(next);}}
      >
        <option value="">Select Team</option>
        {options.map(t => (
            <option key={t.TeamId} value={t.TeamId}>
            {t.TeamName} ({t.TeamId})
            </option>
        ))}
      </select>

      <label htmlFor={`${formId}-dire`}>Dire team</label>
      <select
        id={`${formId}-dire`}
        value={team2}
        disabled={loading||!original}
        onChange={e => {const next=e.target.value;if(winner===team2)setWinner(next);setTeam2(next);}}
      >
        <option value="">Select Team</option>
        {options.map(t => (
            <option key={t.TeamId} value={t.TeamId}>
            {t.TeamName} ({t.TeamId})
            </option>
        ))}
      </select>

      <label htmlFor={`${formId}-winner`}>Winner</label>
      <select
        id={`${formId}-winner`}
        value={winner}
        disabled={loading||!original}
        onChange={e => setWinner(e.target.value)}
      >
        <option value="">Select Winner</option>

        {team1 && (
            <option value={team1}>
            {nameFor(team1)}
            </option>
        )}

        {team2 && team2!==team1 && (
            <option value={team2}>
            {nameFor(team2)}
            </option>
        )}
      </select>
      </div>
      <div className="match-editor-actions">
      <button
        type="button"
        className="ui-button-primary"
        onClick={updateMatch}
        disabled={loading||!original}
      >
        {busy==='update' ? "Updating…" : "Update Match"}
      </button>

      <button type="button" className="ui-button-danger" onClick={deleteMatch}
        disabled={loading||!original}>
        {busy==='delete'?'Deleting…':'Delete Match'}
      </button>
      </div>
      {message && (
        <div role="status" className="match-editor-message">
          {message}
        </div>
      )}
      </div>
      </div>
    </section>
  );
}
