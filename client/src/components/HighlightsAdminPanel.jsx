import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HighlightCard } from './LeagueHighlightsFeed';

function Editor({ story, busy, onSave, onCancel }) {
  const [title, setTitle] = useState(story.title);
  const [body, setBody] = useState(story.body);
  return <form className="highlight-admin-editor" onSubmit={event => {
    event.preventDefault(); onSave({ title, body });
  }}>
    <label>Title<input required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Story<textarea required maxLength={1500} value={body} onChange={event => setBody(event.target.value)} /></label>
    <div className="highlight-admin-actions">
      <button disabled={busy} type="submit">Save</button>
      <button disabled={busy} type="button" onClick={() => onSave({ title: null, body: null })}>Use generated text</button>
      <button disabled={busy} type="button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

export default function HighlightsAdminPanel({ previewLeague, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('published');
  const [before, setBefore] = useState(null);
  const [previous, setPrevious] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const datasetQuery = previewLeague ? `?previewLeague=${previewLeague}` : '';
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ status: filter, limit: '20' });
    if (previewLeague) params.set('previewLeague', previewLeague);
    if (before) params.set('before', before);
    fetch(`/api/admin/analytics/highlights?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load highlights');
        return result;
      }).then(result => { if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [previewLeague, refreshKey, refresh, before, filter]);

  async function update(path, body) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/analytics/highlights${path}${datasetQuery}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update highlights');
      setEditing(null); setRefresh(value => value + 1);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="highlight-admin-panel">
    <div className="highlight-heading"><h4>Automatic highlights</h4><div className="highlight-admin-actions">
      {previewLeague && data?.available && <Link to={`/?previewLeague=${previewLeague}`} target="_blank" rel="noopener noreferrer">
        Preview on homepage
      </Link>}
      {data?.available && <button type="button" disabled={busy}
        onClick={() => update('/settings', { paused: !data.paused })}>
        {data.paused ? 'Resume publication' : 'Pause publication'}
      </button>}
      <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh highlights</button>
    </div></div>
    {data?.paused && <p>New publication is paused. Source corrections still revise or withdraw existing stories.</p>}
    <label>Show<select value={filter} onChange={event => {
      setFilter(event.target.value); setBefore(null); setPrevious([]); setEditing(null);
    }}>
      <option value="published">Published</option><option value="candidate">Candidates</option>
      <option value="withdrawn">Withdrawn</option><option value="all">All stories</option>
    </select></label>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading highlights…</p>}
    {data && !data.available && <p>Run an Analytics build to generate highlights.</p>}
    {data?.available && !data.highlights.length && <p>No {filter === 'all' ? '' : filter} stories in this dataset.</p>}
    {data?.available && <div className="highlight-grid">{data.highlights.map(story =>
      <HighlightCard key={story.id} story={story}>
        <p className="highlight-admin-status">{story.status}{story.hidden ? ' · Hidden' : ''}
          {story.hasOverride ? ' · Edited by admin' : ''}
          {story.overrideNeedsReview ? ' · Source changed: review edited text before it returns to the public feed' : ''}</p>
        {editing === story.id ? <Editor story={story} busy={busy} onSave={body => update(`/${story.id}`, body)}
          onCancel={() => setEditing(null)} /> : <div className="highlight-admin-actions">
          <button type="button" disabled={busy} onClick={() => update(`/${story.id}`, { hidden: !story.hidden })}>
            {story.hidden ? 'Unhide' : 'Hide'}
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(story.id)}>Edit text</button>
        </div>}
      </HighlightCard>)}</div>}
    {(previous.length > 0 || data?.nextBefore) && <div className="highlight-admin-actions">
      <button type="button" disabled={busy || loading || !previous.length} onClick={() => {
        setBefore(previous.at(-1)); setPrevious(old => old.slice(0, -1)); setEditing(null);
      }}>Previous</button>
      <button type="button" disabled={busy || loading || !data?.nextBefore} onClick={() => {
        setPrevious(old => [...old, before]); setBefore(data.nextBefore); setEditing(null);
      }}>Next</button>
    </div>}
  </div>;
}
