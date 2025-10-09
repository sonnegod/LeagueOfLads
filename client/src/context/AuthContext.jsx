import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/user', { credentials: 'include' })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Not logged in');
      })
      .then(
        userData => {
      const accountId = steamId64ToAccountId(userData.steamid); // assumes field is 'steamId'
      setUser({ ...userData, accountId });
    })
    .catch(() => setUser(null))
    .finally(() => setLoading(false));
  }, []);

  function logout() {
    return fetch('/api/auth/logout', { credentials: 'include' }).then(() => {
      setUser(null);
    });
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );

  function steamId64ToAccountId(steamId64) {
    const base = BigInt('76561197960265728');
    return (BigInt(steamId64) - base).toString(); // returns string to safely handle large numbers
  }
}

export function useAuth() {
  return useContext(AuthContext);
}
