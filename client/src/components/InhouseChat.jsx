import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useInhouseActivity} from '../context/inhouseActivity';
import {inhouseRequest} from '../hooks/useInhouses';
import './InhouseChat.css';

export default function InhouseChat({gameId, accountId}) {
  const {chat: activityChat, watchChat, acceptChat, connected, error: streamError} = useInhouseActivity();
  const chat = activityChat?.inhouseId === gameId ? activityChat : null;
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const log = useRef(null), follow = useRef(true), sending = useRef(false), messageId = useRef(null);
  useEffect(() => watchChat(gameId, accountId), [watchChat, gameId, accountId]);
  useLayoutEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat?.messages]);
  const closed = chat && ['completed', 'cancelled'].includes(chat.status);
  async function send(event) {
    event.preventDefault();
    if (sending.current || closed || !chat || !text.trim()) return;
    sending.current = true; setBusy(true); setError('');
    messageId.current ||= crypto.randomUUID();
    try {
      const result = await inhouseRequest(`/inhouses/games/${gameId}/chat`, {method: 'POST',
        body: JSON.stringify({text, clientId: messageId.current})});
      follow.current = true; acceptChat(result); setText(''); messageId.current = null;
    } catch (e) {setError(e.message);}
    finally {sending.current = false; setBusy(false);}
  }
  return <section className="inhouse-card inhouse-chat" aria-label="Lobby chat">
    <header className="inhouse-card-heading"><h2>Lobby chat</h2><small className="inhouse-muted">
      {closed ? 'Closed' : connected ? 'Live' : 'Reconnecting'}</small></header>
    <div ref={log} className="inhouse-chat-log" role="log" aria-label="Lobby messages" aria-live="polite" aria-relevant="additions"
      onScroll={() => {const element = log.current; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;}}>
      {chat?.messages.length ? chat.messages.map(message => <div className="inhouse-chat-line" key={message.id}>
        <div><strong>{message.name}:</strong>{' '}<span>{message.text}</span></div>
        <time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>
      </div>) : <p className="inhouse-muted">{chat ? 'Say hello to your lobby.' : 'Loading chat…'}</p>}
    </div>
    <form onSubmit={send} className="inhouse-chat-compose">
      <textarea aria-label="Message your lobby" placeholder="Message your lobby…" rows={2} maxLength={500}
        disabled={closed || !chat} readOnly={busy} value={text}
        onChange={event => {setText(event.target.value); messageId.current = null;}}
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event);}} />
      <button type="submit" className="inhouse-primary" disabled={busy || closed || !chat || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
    </form>
    {(error || streamError) && <p className="inhouse-chat-error" role="status">{error || 'Chat updates are reconnecting.'}</p>}
  </section>;
}
