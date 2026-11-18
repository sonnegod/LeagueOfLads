import {useState} from 'react';
import AsyncCreatableSelect from 'react-select/async-creatable';

const pickerStyles={
  control:base=>({...base,background:'var(--surface, #111827)',minWidth:0}),
  menu:base=>({...base,background:'var(--surface, #111827)',zIndex:20}),
  singleValue:base=>({...base,color:'var(--text, white)'}),
  input:base=>({...base,color:'var(--text, white)'}),
  option:(base,state)=>({...base,background:state.isFocused?'#334155':'transparent',color:'var(--text, white)'}),
};

export default function RosterPlayerPicker({id,label,accountId,onChange,options,required=false,disabled=false,allowManualEntry=true,compact=false,onSearchError}) {
  const [selected,setSelected]=useState(null),[error,setError]=useState('');
  const value=String(selected?.value)===String(accountId)?selected:null;
  async function search(input) {
    const query=input.trim();
    if(!query)return [];
    setError('');onSearchError?.('');
    try {
      const response=await fetch(`/api/admin/rosters/players?search=${encodeURIComponent(query)}`);
      const result=await response.json();
      if(!response.ok)throw Error('Player search unavailable');
      return result.players.map(player=>({value:player.PlayerId,name:player.PlayerName,
        label:`${player.PlayerName} (${player.PlayerId})`}));
    }catch {
      const message=allowManualEntry?'Player search unavailable. Retry the search or enter an account ID.':'Player search unavailable. Try again.';
      setError(message);onSearchError?.(message);
      return [];
    }
  }
  const styles=compact?{...pickerStyles,
    control:base=>({...pickerStyles.control(base),minHeight:38,height:38,flexWrap:'nowrap'}),
    valueContainer:base=>({...base,padding:'2px 6px',flexWrap:'nowrap'}),
    input:base=>({...pickerStyles.input(base),padding:0,margin:0}),
    menuPortal:base=>{const width=Math.min(280,window.innerWidth-24);return {...base,zIndex:1000,width,left:Math.max(12,Math.min(base.left,window.innerWidth-width-12))};},
  }:pickerStyles;
  return <div className={`roster-player-picker${compact?' roster-player-picker-compact':''}`} title={compact?(error||value?.label||label):undefined}>
    <label htmlFor={`react-select-${id}`}>{label}</label>
    <AsyncCreatableSelect inputId={`react-select-${id}`} instanceId={id} name={id} required={required}
      cacheOptions defaultOptions={options} loadOptions={search}
      value={value} onChange={option=>{setSelected(option);setError('');onChange(option?String(option.value):'',option?.name||'');}}
      isClearable={!compact} isDisabled={disabled} styles={styles} placeholder={compact?'Name / ID':'Search name or account ID…'}
      components={compact?{DropdownIndicator:null,IndicatorSeparator:null}:undefined}
      menuPortalTarget={compact&&typeof document!=='undefined'?document.body:undefined} menuPosition={compact?'fixed':'absolute'}
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
    {error&&!compact&&<small className="sportsbook-error" role="status">{error}</small>}
  </div>;
}
