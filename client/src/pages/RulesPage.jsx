import { useEffect, useState } from 'react';
import { filterRuleItems } from '../utils/ruleSearch.js';
import './RulesPage.css';

export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/rules', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load rules.');
        return response.json();
      })
      .then((data) => setRules(data.rules || []))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const searchTerm = search.trim();
  const sections = [];
  for (const item of filterRuleItems(rules, search)) {
    if (item.ItemType === 'header') {
      sections.push({ key: item.RuleId, heading: item.RuleText, rules: [] });
    } else {
      if (sections.length === 0) sections.push({ key: item.RuleId, heading: null, rules: [] });
      sections.at(-1).rules.push(item);
    }
  }

  return (
    <div className="ui-page rules-page">
      <h1>Rules</h1>
      <div className="rules-search" role="search">
        <label htmlFor="rules-search-input">Search rules</label>
        <div className="rules-search-controls">
          <input id="rules-search-input" type="search" value={search}
            onChange={(event) => setSearch(event.target.value)} placeholder="Search rules or headers" />
          {search && <button type="button" onClick={() => setSearch('')}>Clear</button>}
        </div>
      </div>
      {loading && <p>Loading rules...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && (sections.length
        ? sections.map((section) => {
          const ruleList = section.rules.length > 0 && (
            <ul className="rules-list">{section.rules.map((rule) => (
              <li key={rule.RuleId} className="rules-list-text">{rule.RuleText}</li>
            ))}</ul>
          );
          return section.heading
            ? <details className="rules-section" key={`${section.key}:${searchTerm}`} open>
                <summary>{section.heading}</summary>
                {ruleList}
              </details>
            : <section className="rules-section" key={section.key}>{ruleList}</section>;
        })
        : <p>{searchTerm ? 'No matching rules or headers.' : 'No rules have been posted yet.'}</p>)}
    </div>
  );
}
