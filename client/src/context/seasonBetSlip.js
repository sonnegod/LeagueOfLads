import {createContext,useContext} from 'react';

export const SeasonBetSlipContext=createContext(null);
export function useSeasonBetSlip(){return useContext(SeasonBetSlipContext);}
