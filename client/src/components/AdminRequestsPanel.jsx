import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function AdminRequestsPanel() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/requests', { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load requests');
        setRequests(data.requests || []);
      })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function deleteRequest(request) {
    if (!window.confirm(`Delete request #${request.ProblemId} from ${request.PlayerName}?`)) return;
    setDeletingId(request.ProblemId);
    setError('');
    try {
      const response = await fetch(`/api/admin/requests/${request.ProblemId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to delete request');
      setRequests((current) => current.filter((item) => item.ProblemId !== request.ProblemId));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="ui-panel admin-requests-panel" aria-labelledby="admin-requests-heading">
      <div className="admin-requests-heading">
        <div>
          <h2 id="admin-requests-heading">Requests</h2>
          <p>Requests submitted by players.</p>
        </div>
        {!loading && <span className="admin-requests-count">{requests.length} total</span>}
      </div>
      {error && <p role="alert" className="admin-requests-error">{error}</p>}
      {loading ? <p>Loading requests...</p> : requests.length === 0 ? (
        <p>No requests have been submitted.</p>
      ) : (
        <div className="admin-requests-list">
          {requests.map((request) => (
            <article className="admin-request-card" key={request.ProblemId}>
              <div className="admin-request-content">
                <div className="admin-request-meta">
                  <span>Request #{request.ProblemId}</span>
                  {request.PlayerName === 'Unknown player' ? (
                    <span>Unknown player · ID {request.UserId ?? 'unavailable'}</span>
                  ) : (
                    <Link to={`/player/${request.UserId}`}>{request.PlayerName} · ID {request.UserId}</Link>
                  )}
                </div>
                <p>{request.Comment}</p>
              </div>
              <button className="ui-button-danger" type="button"
                disabled={deletingId !== null} onClick={() => deleteRequest(request)}
                aria-label={`Delete request ${request.ProblemId}`}>
                {deletingId === request.ProblemId ? 'Deleting...' : 'Delete'}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
