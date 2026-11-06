import {useCallback, useEffect, useRef, useState} from 'react';
import {inhouseRequest} from './useInhouses';

export function useInhouseAccess() {
  const [state, setState] = useState(null), [error, setError] = useState(''), [connected, setConnected] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async signal => {
    const startedAt = generation.current;
    try {
      const next = await inhouseRequest('/inhouses/management/access', {signal});
      if (!signal?.aborted && startedAt === generation.current) {setState(next); setError('');}
    } catch (e) {
      if (signal?.aborted || startedAt !== generation.current) return;
      if ([401, 403].includes(e.status)) {
        setState({permissions: {canManage: false}});
        window.dispatchEvent(new Event('inhouses:changed'));
      }
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let source, fallback = true;
    const read = () => {if (!document.hidden) refresh(controller.signal);};
    read();
    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/inhouses/management/stream');
      source.addEventListener('access', event => {
        if (controller.signal.aborted) return;
        try {
          const next = JSON.parse(event.data);
          generation.current++;
          setState(next); setError(''); fallback = false; setConnected(true);
          window.dispatchEvent(new Event('inhouses:changed'));
          if (!next.permissions.canManage) {source.close(); setConnected(false);}
        } catch {fallback = true;}
      });
      source.onerror = () => {fallback = true; setConnected(false); read();};
    }
    const timer = setInterval(() => {if (fallback) read();}, 3000);
    document.addEventListener('visibilitychange', read);
    return () => {controller.abort(); source?.close(); clearInterval(timer); document.removeEventListener('visibilitychange', read);};
  }, [refresh]);
  return {state, error, connected, refresh};
}
