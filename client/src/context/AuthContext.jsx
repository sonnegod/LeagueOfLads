import { createContext, useContext, useState, useEffect } from 'react';

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
      .then(userData => setUser(userData))
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
}

export function useAuth() {
  return useContext(AuthContext);
}
