import { useEffect, useRef, useState } from 'react';
import { filterRuleItems } from '../utils/ruleSearch.js';
import './RulesAdminPanel.css';

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to save rules.');
  return data;
}

function placeRule(rules, ruleId, index) {
  const moving = rules.find((rule) => rule.RuleId === ruleId);
  if (!moving) return rules;
  const remaining = rules.filter((rule) => rule.RuleId !== ruleId);
  remaining.splice(index, 0, moving);
  return remaining;
}

function draftFor(rule) {
  return rule.RuleText;
}

export default function RulesAdminPanel() {
  const [rules, setRules] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newHeader, setNewHeader] = useState('');
  const [newText, setNewText] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const [dragPreview, setDragPreview] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/rules', { signal: controller.signal })
      .then(readResponse)
      .then((data) => {
        setRules(data.rules || []);
        setDrafts(Object.fromEntries((data.rules || []).map((rule) => [rule.RuleId, draftFor(rule)])));
      })
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function run(action, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function addItem(event, itemType) {
    event.preventDefault();
    const text = itemType === 'header' ? newHeader.trim() : newText.trim();
    if (!text) return;
    run(async () => {
      const data = await readResponse(await fetch('/api/admin/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType, text }),
      }));
      setRules((current) => [...current, data.rule]);
      setDrafts((current) => ({ ...current, [data.rule.RuleId]: draftFor(data.rule) }));
      if (itemType === 'header') setNewHeader('');
      else setNewText('');
    }, `${itemType === 'header' ? 'Header' : 'Rule'} added.`);
  }

  function saveRule(rule) {
    const draft = drafts[rule.RuleId] ?? draftFor(rule);
    const text = draft.trim();
    if (!text || text === rule.RuleText) return;
    run(async () => {
      const data = await readResponse(await fetch(`/api/admin/rules/${rule.RuleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }));
      setRules((current) => current.map((item) => item.RuleId === rule.RuleId ? data.rule : item));
      setDrafts((current) => ({ ...current, [rule.RuleId]: draftFor(data.rule) }));
    }, `${rule.ItemType === 'header' ? 'Header' : 'Rule'} saved.`);
  }

  function deleteRule(rule) {
    if (!window.confirm(`Delete this ${rule.ItemType === 'header' ? 'header' : 'rule'}?`)) return;
    run(async () => {
      await readResponse(await fetch(`/api/admin/rules/${rule.RuleId}`, { method: 'DELETE' }));
      setRules((current) => current.filter((item) => item.RuleId !== rule.RuleId));
      setDrafts((current) => {
        const next = { ...current };
        delete next[rule.RuleId];
        return next;
      });
    }, `${rule.ItemType === 'header' ? 'Header' : 'Rule'} deleted.`);
  }

  function moveRule(rule, direction) {
    run(async () => {
      const data = await readResponse(await fetch(`/api/admin/rules/${rule.RuleId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      }));
      setRules(data.rules);
    }, 'Rule order updated.');
  }

  function dropIndexAt(clientY, ruleId) {
    const cards = [...(listRef.current?.querySelectorAll('[data-rule-id]') || [])]
      .filter((card) => Number(card.dataset.ruleId) !== ruleId);
    return cards.filter((card) => {
      const bounds = card.getBoundingClientRect();
      return clientY >= bounds.top + bounds.height / 2;
    }).length;
  }

  function startDrag(event, rule, index) {
    if (busy || searchActive || rules.length < 2 || (event.pointerType === 'mouse' && event.button !== 0) ||
      event.target.closest('input, textarea, button, select, a, label')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { ruleId: rule.RuleId, pointerId: event.pointerId, startY: event.clientY, currentY: event.clientY, dropIndex: index };
    setDragPreview({ ...dragRef.current });
  }

  function updateDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.currentY = event.clientY;
    drag.dropIndex = dropIndexAt(event.clientY, drag.ruleId);
    setDragPreview({ ...drag });
  }

  function cancelDrag() {
    dragRef.current = null;
    setDragPreview(null);
  }

  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dropIndex = dropIndexAt(event.clientY, drag.ruleId);
    cancelDrag();
    const original = rules;
    const reordered = placeRule(original, drag.ruleId, dropIndex);
    if (reordered.every((rule, index) => rule.RuleId === original[index].RuleId)) return;
    setRules(reordered);
    run(async () => {
      try {
        const data = await readResponse(await fetch('/api/admin/rules/order', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ruleIds: reordered.map((rule) => rule.RuleId) }),
        }));
        setRules(data.rules);
      } catch (err) {
        try {
          const data = await readResponse(await fetch('/api/rules'));
          setRules(data.rules);
        } catch {
          setRules(original);
        }
        throw err;
      }
    }, 'Rule order updated.');
  }

  const searchActive = Boolean(search.trim());
  const visibleRules = filterRuleItems(rules, search);
  const remainingRules = dragPreview ? rules.filter((rule) => rule.RuleId !== dragPreview.ruleId) : [];
  const dropBeforeId = remainingRules[dragPreview?.dropIndex]?.RuleId;
  const dropAfterId = dragPreview?.dropIndex === remainingRules.length ? remainingRules.at(-1)?.RuleId : null;

  return (
    <section className="rules-admin" aria-labelledby="rules-admin-heading">
      <h2 id="rules-admin-heading">Rules</h2>
      <p>Each rule card is one bullet. Header cards start a heading for the rules beneath them. Drag a card from its open space or use the arrows to set the order.</p>
      <div className="rules-admin-search" role="search">
        <label htmlFor="rules-admin-search-input">Search rules and headers</label>
        <div className="rules-admin-search-controls">
          <input id="rules-admin-search-input" type="search" value={search}
            onChange={(event) => setSearch(event.target.value)} placeholder="Search rule or header text" />
          {search && <button type="button" onClick={() => setSearch('')}>Clear</button>}
        </div>
      </div>
      {searchActive && <p className="rules-admin-search-note">Showing {visibleRules.length} of {rules.length} items. Clear search to reorder.</p>}
      {error && <p role="alert" className="rules-admin-error">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p>Loading rules...</p>}
      {!loading && <>
        <ol className="rules-admin-list" ref={listRef}>
          {visibleRules.map((rule, index) => {
            const draft = drafts[rule.RuleId] ?? draftFor(rule);
            return (
            <li className={`rules-admin-card${dragPreview?.ruleId === rule.RuleId ? ' is-dragging' : ''}${dropBeforeId === rule.RuleId ? ' drop-before' : ''}${dropAfterId === rule.RuleId ? ' drop-after' : ''}`}
              key={rule.RuleId} data-rule-id={rule.RuleId}
              style={dragPreview?.ruleId === rule.RuleId ? { transform: `translateY(${dragPreview.currentY - dragPreview.startY}px)` } : undefined}
              onPointerDown={(event) => startDrag(event, rule, index)}
              onPointerMove={updateDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag}>
              <div className="rules-admin-card-content">
                <label htmlFor={`rule-${rule.RuleId}`}>{rule.ItemType === 'header' ? 'Header' : 'Rule'}</label>
                {rule.ItemType === 'header'
                  ? <input id={`rule-${rule.RuleId}`} type="text" maxLength="120" value={draft}
                      onChange={(event) => setDrafts((current) => ({ ...current, [rule.RuleId]: event.target.value }))} />
                  : <textarea id={`rule-${rule.RuleId}`} rows="2" maxLength="2000" value={draft}
                      onChange={(event) => setDrafts((current) => ({ ...current, [rule.RuleId]: event.target.value }))} />}
              </div>
              <div className="rules-admin-actions">
                <button type="button" onClick={() => moveRule(rule, 'up')} disabled={busy || searchActive || index === 0} aria-label={`Move ${rule.ItemType} ${rule.RuleText} up`}>↑</button>
                <button type="button" onClick={() => moveRule(rule, 'down')} disabled={busy || searchActive || index === rules.length - 1} aria-label={`Move ${rule.ItemType} ${rule.RuleText} down`}>↓</button>
                <button type="button" className="ui-button-primary" onClick={() => saveRule(rule)}
                  disabled={busy || !draft.trim() || draft.trim() === rule.RuleText}>Save</button>
                <button type="button" className="ui-button-danger" onClick={() => deleteRule(rule)} disabled={busy}>Delete</button>
              </div>
            </li>
            );
          })}
        </ol>
        {rules.length === 0 && <p>No rules have been added yet.</p>}
        {rules.length > 0 && visibleRules.length === 0 && <p>No matching rules or headers.</p>}
        <form className="rules-admin-add" onSubmit={(event) => addItem(event, 'header')}>
          <h3>Add a header</h3>
          <label htmlFor="new-rule-header">Header text</label>
          <input id="new-rule-header" type="text" maxLength="120" value={newHeader}
            onChange={(event) => setNewHeader(event.target.value)} />
          <button className="ui-button-primary" type="submit" disabled={busy || !newHeader.trim()}>Add header</button>
        </form>
        <form className="rules-admin-add" onSubmit={(event) => addItem(event, 'rule')}>
          <h3>Add a rule</h3>
          <label htmlFor="new-rule-text">Rule text</label>
          <textarea id="new-rule-text" rows="3" maxLength="2000" value={newText}
            onChange={(event) => setNewText(event.target.value)} />
          <button className="ui-button-primary" type="submit" disabled={busy || !newText.trim()}>Add rule</button>
        </form>
      </>}
    </section>
  );
}
