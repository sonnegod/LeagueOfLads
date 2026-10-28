import {createContext,useContext} from 'react';

export const LiveMatchesContext=createContext(null);
export function useLiveMatches() {
  const context=useContext(LiveMatchesContext);
  if(!context)throw Error('LiveMatchesProvider is required');
  return context;
}
