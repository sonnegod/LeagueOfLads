import {useState} from 'react';

const count=value=>Number(value).toLocaleString('en-US');
export default function SiteApiErrorBreakdown({data}) {
  const [view,setView]=useState('status');
  if(!data)return null;
  const routes=view==='routes',rows=routes?data.routes:data.statuses;
  return <div className="site-api-error-details">
    <div className="site-api-error-heading"><h3>API error details</h3>
      <div className="ui-tabs" role="group" aria-label="API error breakdown">
        <button type="button" className="ui-tab" aria-pressed={!routes} onClick={()=>setView('status')}>Status codes</button>
        <button type="button" className="ui-tab" aria-pressed={routes} onClick={()=>setView('routes')}>API routes</button>
      </div>
    </div>
    <table className="site-analytics-table site-api-error-table" aria-label={routes?'Top API routes with errors':'API errors by status'}>
      <thead><tr><th>Status</th><th>{routes?'API route':'Meaning'}</th><th>Requests</th></tr></thead>
      <tbody>{rows.map(row=><tr key={routes?`${row.status}:${row.method}:${row.route}`:row.status??row.family}>
        <td><span className="site-api-error-code">{row.status??row.family}</span></td>
        <td>{routes?<><code>{row.method} {row.route}</code><small>{row.status===401&&row.route==='/api/auth/user'?'Signed-out session check':row.label}</small></>:row.label}</td>
        <td>{count(row.count)}</td>
      </tr>)}{!rows.length&&<tr><td colSpan="3">{routes&&data.legacyRequests?'Route details were not collected for these earlier requests.':'No API errors recorded in this period.'}</td></tr>}</tbody>
    </table>
    {routes&&rows.length>0&&<p className="site-analytics-note">Top 20 combinations of route, method and response status. IDs are replaced by route parameters.</p>}
    {data.legacyRequests>0&&<p className="site-analytics-note">{count(data.legacyRequests)} earlier error responses have limited detail; their original status or route was not saved.</p>}
    {data.startedAt&&<p className="site-analytics-note">Detailed collection began {new Date(data.startedAt).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'})} NY.</p>}
  </div>;
}
