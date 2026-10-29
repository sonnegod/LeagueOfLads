import {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth} from './AuthContext';
import {InhouseActivityContext} from './inhouseActivity';
import {inhouseRequest} from '../hooks/useInhouses';

function mergeChat(previous, next, ownerId) {
  const messages = previous?.inhouseId === next.inhouseId && previous.ownerId === ownerId ? previous.messages : [];
  return {...next, ownerId, messages: [...new Map([...messages, ...next.messages].map(message => [message.id, message])).values()]
    .sort((a, b) => a.id - b.id).slice(-100)};
}

// The sidebar and current lobby share one connection. Only a participant's
// current room is subscribed; queue-only viewers receive no chat messages.
export default function InhouseActivityProvider({children}) {
  const {user} = useAuth(), ownerId = String(user?.accountId || '');
  const enabled = Boolean(user?.isAdmin);
  const [queue, setQueue] = useState(null), [error, setError] = useState('');
  const [requested, setRequested] = useState(null), [chatState, setChatState] = useState(null);
  const [connected, setConnected] = useState(false), load = useRef(() => {});
  const gameId = requested?.ownerId === ownerId ? requested.gameId : null;
  const watchChat = useCallback((id, accountId) => {
    const room = {gameId: Number(id), ownerId: String(accountId)};
    setRequested(room);
    return () => setRequested(current => current === room ? null : current);
  }, []);
  const acceptChat = useCallback(packet => {
    if (gameId && packet.inhouseId === gameId) setChatState(previous => mergeChat(previous, packet, ownerId));
  }, [gameId, ownerId]);
  const refresh = useCallback(() => load.current(), []);

  useEffect(() => {
    if (!enabled) {load.current = () => {}; return;}
    const controller = new AbortController(), query = gameId ? `?gameId=${gameId}` : '';
    let source, fallback = true, reading = false, sequence = 0;
    const receiveChat = packet => setChatState(previous => mergeChat(previous, packet, ownerId));
    const read = async () => {
      if (document.hidden || controller.signal.aborted || reading) return;
      reading = true;
      const startedAt = sequence;
      try {
        const data = await inhouseRequest(`/inhouses/activity${query}`, {signal: controller.signal});
        if (!controller.signal.aborted && sequence === startedAt) {
          setQueue(data.queue); if (data.chat) receiveChat(data.chat); setError('');
        }
      } catch (e) {if (!controller.signal.aborted) setError(e.message);}
      finally {reading = false;}
    };
    load.current = read;
    function open() {
      if (document.hidden || controller.signal.aborted) return;
      if (typeof EventSource === 'undefined') {read(); return;}
      source = new EventSource(`/api/inhouses/activity/stream${query}`);
      const receive = (event, chat) => {
        if (controller.signal.aborted) return;
        try {
          const data = JSON.parse(event.data);
          if (chat) receiveChat(data); else setQueue(data);
          sequence++; fallback = false; setConnected(true); setError('');
        } catch {fallback = true;}
      };
      source.addEventListener('queue', event => receive(event, false));
      source.addEventListener('chat', event => receive(event, true));
      source.onerror = () => {fallback = true; setConnected(false); setError('Live updates are reconnecting'); read();};
    }
    function visibility() {
      source?.close(); source = null; fallback = true; setConnected(false);
      if (!document.hidden) open();
    }
    setConnected(false); open();
    const timer = setInterval(() => {if (fallback) read();}, 3000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('inhouses:changed', read);
    return () => {
      controller.abort(); source?.close(); clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('inhouses:changed', read);
    };
  }, [gameId, ownerId, enabled]);

  const chat = enabled && chatState?.ownerId === ownerId && chatState.inhouseId === gameId ? chatState : null;
  return <InhouseActivityContext.Provider value={{queue: enabled ? queue : null, error: enabled ? error : '', refresh, connected: enabled && connected, chat, watchChat, acceptChat}}>
    {children}
  </InhouseActivityContext.Provider>;
}
