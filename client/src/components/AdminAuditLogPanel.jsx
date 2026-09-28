import { useCallback, useEffect, useRef, useState } from 'react';
import './AdminAuditLogPanel.css';

function formatAuditTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export default function AdminAuditLogPanel() {
  const [entries, setEntries] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState([null]);
  const [nextBeforeId, setNextBeforeId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const controllerRef = useRef(null);

  const loadPage = useCallback(async (beforeId = null, index = 0, search = '') => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (beforeId !== null) params.set('before', beforeId);
      if (search) params.set('search', search);
      const url = `/api/admin/auditLog${params.size ? `?${params}` : ''}`;
      const response = await fetch(url, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load audit log');
      setEntries(data.entries || []);
      setNextBeforeId(data.nextBeforeId);
      setPageIndex(index);
      setCursors((current) => index === 0 ? [null] : [...current.slice(0, index), beforeId]);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadPage();
    return () => controllerRef.current?.abort();
  }, [loadPage]);

  const submitSearch = (event) => {
    event.preventDefault();
    const term = searchInput.trim();
    setSearchTerm(term);
    loadPage(null, 0, term);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
    loadPage();
  };

  return (
    <section className="ui-panel admin-audit-panel" aria-labelledby="admin-audit-heading">
      <div className="admin-audit-heading">
        <div>
          <h2 id="admin-audit-heading">Audit Log</h2>
          <p>Admin actions, newest first. Showing up to 50 per page.</p>
        </div>
        <button type="button" onClick={() => loadPage(null, 0, searchTerm)} disabled={loading}>Refresh</button>
      </div>
      <form className="admin-audit-search" onSubmit={submitSearch} role="search">
        <label htmlFor="admin-audit-search-input">Search audit log</label>
        <div className="admin-audit-search-controls">
          <input id="admin-audit-search-input" type="search" value={searchInput} maxLength={120}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Player name, account ID, or action" />
          <button type="submit">Search</button>
          {searchTerm && <button type="button" onClick={clearSearch}>Clear</button>}
        </div>
      </form>
      {error && <p role="alert" className="admin-audit-error">{error}</p>}
      {loading ? <p>Loading audit log...</p> : entries.length === 0 ? (
        <p>{searchTerm ? 'No matching audit entries.' : 'No audit entries found.'}</p>
      ) : (
        <div className="admin-audit-table-wrap">
          <table className="admin-audit-table">
            <thead><tr><th scope="col">User (ID)</th><th scope="col">Action</th><th scope="col">Time</th></tr></thead>
            <tbody>
              {entries.map((entry) => {
                const actor = entry.ActorAdminId == null
                  ? 'Unknown admin'
                  : `${entry.ActorAdminName || 'Unknown player'} (${entry.ActorAdminId})`;
                const time = formatAuditTime(entry.CreatedAt);
                return (
                  <tr key={entry.AuditLogId}>
                    <td>{actor}</td>
                    <td><strong>{entry.Type || 'Admin action'}</strong>
                      {entry.Message && <div className="admin-audit-detail">{entry.Message}</div>}
                    </td>
                    <td>{time ? <time dateTime={entry.CreatedAt} title={entry.CreatedAt}>{time}</time> : 'Unknown'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && entries.length > 0 && (
        <nav className="admin-audit-pagination" aria-label="Audit log pages">
          <button type="button" disabled={pageIndex === 0}
            onClick={() => loadPage(cursors[pageIndex - 1], pageIndex - 1, searchTerm)}>Previous</button>
          <span>Page {pageIndex + 1}</span>
          <button type="button" disabled={nextBeforeId === null}
            onClick={() => loadPage(nextBeforeId, pageIndex + 1, searchTerm)}>Next</button>
        </nav>
      )}
    </section>
  );
}
