import {createContext, useContext} from 'react';

export const InhouseAdminContext = createContext(null);
export const useInhouseAdmin = () => useContext(InhouseAdminContext);
