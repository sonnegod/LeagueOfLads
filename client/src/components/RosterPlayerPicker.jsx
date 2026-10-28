import {useState} from 'react';
import AsyncCreatableSelect from 'react-select/async-creatable';

const pickerStyles={
  control:base=>({...base,background:'var(--surface, #111827)',minWidth:0}),
  menu:base=>({...base,background:'var(--surface, #111827)',zIndex:20}),
  singleValue:base=>({...base,color:'var(--text, white)'}),
  input:base=>({...base,color:'var(--text, white)'}),
  option:(base,state)=>({...base,background:state.isFocused?'#334155':'transparent',color:'var(--text, white)'}),
};

export default function RosterPlayerPicker({id,label,accountId,onChange,options,required=false,disabled=false,allowManualEntry=true}) {
  const [selected,setSelected]=useState(null),[error,setError]=useState('');
  const value=String(selected?.value)===String(accountId)?selected:null;
  async function search(input) {
    const query=input.trim();
    if(!query)return [];
    setError('');
    try {
      const response=await fetch(`/api/admin/rosters/players?search=${encodeURIComponent(query)}`);
      const result=await response.json();
      if(!response.ok)throw Error('Player search unavailable');
      return result.players.map(player=>({value:player.PlayerId,name:player.PlayerName,
        label:`${player.PlayerName} (${player.PlayerId})`}));
    }catch {
      setError(allowManualEntry?'Player search unavailable. Retry the search or enter an account ID.':'Player search unavailable. Try again.');
      return [];
    }
  }
  return <div className="roster-player-picker">
    <label htmlFor={`react-select-${id}`}>{label}</label>
    <AsyncCreatableSelect inputId={`react-select-${id}`} instanceId={id} name={id} required={required}
      cacheOptions defaultOptions={options} loadOptions={search}
      value={value} onChange={option=>{setSelected(option);setError('');onChange(option?String(option.value):'',option?.name||'');}}
      isClearable isDisabled={disabled} styles={pickerStyles} placeholder="Search name or account ID…"
      isValidNewOption={(input,selection,results)=>allowManualEntry&&/^\d+$/.test(input.trim())
        &&Number.isSafeInteger(Number(input))&&Number(input)>0
        &&![...selection,...results].some(option=>Number(option.value)===Number(input))}
      formatCreateLabel={input=>`Use account ID ${input.trim()}`}
      onCreateOption={input=>{
        const playerId=String(Number(input.trim()));
        setSelected({value:playerId,name:'',label:`Account ID ${playerId}`});setError('');onChange(playerId,'');
      }}
      noOptionsMessage={({inputValue})=>allowManualEntry
        ?inputValue?'No players found. Enter a numeric account ID to add a new player.':'Search for a player or enter a new account ID.'
        :inputValue?'No players found.':'Search for an existing player.'}/>
    {error&&<small className="sportsbook-error" role="status">{error}</small>}
  </div>;
}
