import {useState} from 'react';
import {Link} from 'react-router-dom';

const count=value=>Number(value).toLocaleString('en-US');
const date=value=>new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const dayAt=(from,index)=>new Date(Date.parse(`${from}T12:00:00Z`)+index*86400000).toISOString().slice(0,10);
const columns=[['name','Player'],['activeDays','Active days'],['pageViews','Page views'],['lastSeen','Last seen']];
const pageSize=10;

export default function SiteViewerActivity({viewers=[],days,from}) {
  const [search,setSearch]=useState(''),[sort,setSort]=useState({key:'activeDays',ascending:false}),[page,setPage]=useState(0);
  const query=search.trim().toLocaleLowerCase();
  const filtered=viewers.filter(row=>!query||`${row.name} ${row.playerId}`.toLocaleLowerCase().includes(query))
    .sort((a,b)=>{
      const result=['name','lastSeen'].includes(sort.key)?String(a[sort.key]).localeCompare(String(b[sort.key])):a[sort.key]-b[sort.key];
      return (sort.ascending?result:-result)||b.pageViews-a.pageViews||String(a.name).localeCompare(String(b.name));
    });
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize)),currentPage=Math.min(page,pages-1);
  const displayed=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const maximum=viewers.reduce((max,row)=>Math.max(max,...row.activity),1);
  const repeat=viewers.filter(row=>row.activeDays>1).length;
  const sortBy=key=>{setSort(current=>({key,ascending:current.key===key?!current.ascending:key==='name'}));setPage(0);};

  return <section className="site-analytics-panel site-viewers" aria-labelledby="site-viewers-title">
    <div className="site-analytics-panel-heading"><div><h2 id="site-viewers-title">Signed-in viewers</h2>
      <p>{count(viewers.length)} players{days>1?` · ${count(repeat)} active on multiple days`:''}</p></div>
      <label className="site-viewers-search" htmlFor="site-viewers-search">Find a player<input id="site-viewers-search" type="search"
        placeholder="Search players" value={search} onChange={event=>{setSearch(event.target.value);setPage(0);}} /></label>
    </div>
    <table className="site-analytics-table site-viewers-table">
      <thead><tr>{columns.map(([key,label])=><th key={key} scope="col" className={key==='lastSeen'?'site-viewers-last-seen':undefined}
        aria-sort={sort.key===key?(sort.ascending?'ascending':'descending'):'none'}>
        <button className="ui-table-sort-button" type="button" onClick={()=>sortBy(key)}>{label}{sort.key===key&&<span aria-hidden="true">{sort.ascending?' ↑':' ↓'}</span>}</button>
      </th>)}</tr></thead>
      <tbody>{displayed.map(row=><tr key={row.playerId}>
        <td><Link className="site-viewer-name" to={`/player/${row.playerId}`}>{row.name}</Link>
          <div className="site-viewer-activity" role="img" aria-label={`${row.name}: ${row.activeDays} active days, ${row.pageViews} page views`}
            style={{'--activity-count':row.activity.length}}>
            {row.activity.map((views,index)=><span key={index} data-active={views>0}
              style={views?{opacity:.25+.75*Math.sqrt(views/maximum)}:undefined}
              title={`${days===1?`${String(index).padStart(2,'0')}:00 NY`:date(dayAt(from,index))}: ${count(views)} page views`} />)}
          </div><small className="site-viewer-mobile-last">Last seen {date(row.lastSeen)}</small>
        </td>
        <td>{row.activeDays}<small>of {days} {days===1?'day':'days'}</small></td><td>{count(row.pageViews)}</td>
        <td className="site-viewers-last-seen">{date(row.lastSeen)}</td>
      </tr>)}{!displayed.length&&<tr><td colSpan="4" className="site-viewers-empty">{query?'No players match your search.':'No identified viewing activity in this period yet.'}</td></tr>}</tbody>
    </table>
    {pages>1&&<div className="site-viewers-pagination"><span>{currentPage*pageSize+1}–{Math.min((currentPage+1)*pageSize,filtered.length)} of {count(filtered.length)}</span>
      <button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</button>
      <button type="button" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}>Next</button></div>}
    <p className="site-analytics-note">Viewing activity across browsers, rather than Steam sign-in counts. Each square is one {days===1?'hour':'day'}; brighter squares mean more page views. Anonymous visitors remain in the totals above.</p>
  </section>;
}
