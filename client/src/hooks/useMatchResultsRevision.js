import {useEffect,useState} from 'react';
export default function useMatchResultsRevision() {
  const [revision,setRevision]=useState(0);
  useEffect(()=>{const changed=()=>setRevision(n=>n+1);window.addEventListener('league-results:changed',changed);return()=>window.removeEventListener('league-results:changed',changed);},[]);
  return revision;
}
