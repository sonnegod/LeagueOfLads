import {useCallback, useEffect, useState} from 'react';

export async function inhouseRequest(path, options = {}) {
  const response = await fetch(`/api${path}`, {credentials: 'include', cache: 'no-store',
    ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    headers: {'Content-Type': 'application/json', ...options.headers}});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Inhouse request failed');
  return data;
}

export function useInhouses(userId, {admin=false}={}) {
  const statePath=admin?'/admin/inhouses/status':'/inhouses/state',streamPath=admin?'/admin/inhouses/stream':'/inhouses/stream';
  const [state, setState] = useState(null), [profile, setProfile] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const refresh = useCallback(async () => {
    const data = await inhouseRequest(statePath);
    setState(current => !current || data.revision >= current.revision ? data : current);
  }, [statePath]);
  useEffect(() => {
    const controller = new AbortController();
    let source = null, fallback = true, timer, reading = false;
    const read = () => {
      if (document.hidden || controller.signal.aborted || reading) return;
      reading = true;
      inhouseRequest(statePath, {signal: controller.signal}).then(data => {
        if (!controller.signal.aborted) {setState(current => !current || data.revision >= current.revision ? data : current); setError('');}
      }).catch(e => {if (!controller.signal.aborted) setError(e.message);}).finally(() => {reading = false;});
    };
    function open() {
      if (document.hidden) return;
      read();
      if (typeof EventSource === 'undefined') return;
      source = new EventSource(`/api${streamPath}`);
      source.addEventListener('state', event => {
        try {
          const next = JSON.parse(event.data);
          setState(current => !current || next.revision >= current.revision ? next : current);
          setError(''); fallback = false; setConnected(true);
        } catch {fallback = true;}
      });
      source.onerror = () => {fallback = true; setConnected(false);};
    }
    function visibility() {
      source?.close(); source = null; fallback = true; setConnected(false);
      if (!document.hidden) open();
    }
    open();
    timer = setInterval(() => {if (fallback) read();}, 3000);
    document.addEventListener('visibilitychange', visibility);
    return () => {controller.abort(); source?.close(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility);};
  }, [statePath,streamPath]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    inhouseRequest('/inhouses/me', {signal: controller.signal}).then(data => setProfile(data.player))
      .catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [userId]);
  const run = useCallback(async (path, method, body = {}) => {
    setBusy(true); setError('');
    try {
      const result = await inhouseRequest(path, {method, body: JSON.stringify(body)});
      if (result.player) setProfile(result.player);
      await refresh();
      window.dispatchEvent(new Event('inhouses:changed'));
      return result;
    } catch (e) {setError(e.message); return null;}
    finally {setBusy(false);}
  }, [refresh]);
  return {state, profile: userId ? profile : null, error, setError, busy, run, refresh, connected};
}

export function useInhouseNow(serverNow) {
  const [localNow, setLocalNow] = useState(Date.now);
  const [offset, setOffset] = useState(0);
  useEffect(() => {if (serverNow) setOffset(serverNow - Date.now());}, [serverNow]);
  useEffect(() => {const timer = setInterval(() => setLocalNow(Date.now()), 1000); return () => clearInterval(timer);}, []);
  return localNow + offset;
}
