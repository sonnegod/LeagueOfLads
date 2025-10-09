import { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function SearchPage() {
  const query = useQuery().get("q") || "";
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchResults() {
      if (!query) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();


        setResults(data);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchResults();
  }, [query]);

  if (loading) return <div>Loading search results...</div>;
  if (!results.length) return <div>No results found for "{query}"</div>;

  return (
    <div style={{ padding: 0 }}>
      <h1>Search Results for "{query}"</h1>
      <ul>
        {results.map((item) => (
          <li key={`${item.type}-${item.id}`}>
            <Link to={`/${item.type}/${item.id}`}>
              {item.name} <em>({item.type})</em>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
