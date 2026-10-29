import {createContext, useContext} from 'react';

export const InhouseActivityContext = createContext(null);
export const useInhouseActivity = () => useContext(InhouseActivityContext);
