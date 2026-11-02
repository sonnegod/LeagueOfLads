import {useLayoutEffect,useRef} from 'react';
import {ChevronRight} from 'lucide-react';
import './AdminNavigation.css';

const workspaces=[
  {key:'league',label:'League'},
  {key:'inhouses',label:'Inhouses'},
  {key:'admin',label:'Admin'},
];

export default function AdminNavigation({workspace,onWorkspaceChange,sections,activeSection,onSectionChange,actions}) {
  const sectionsRef=useRef(null);
  useLayoutEffect(()=>{
    const rail=sectionsRef.current;if(!rail)return;
    const navigation=rail.closest('nav');
    const revealSelected=()=>{
      const selected=rail.querySelector('[aria-pressed="true"]');if(!selected)return;
      const scroller=rail;
      // Layout offsets stay stable while the entrance animation transforms tabs.
      let start=0;
      for(let element=selected;element&&element!==scroller;element=element.offsetParent)start+=element.offsetLeft;
      const end=start+selected.offsetWidth;
      if(start<scroller.scrollLeft+6)scroller.scrollLeft=Math.max(0,start-6);
      else if(end>scroller.scrollLeft+scroller.clientWidth-6)scroller.scrollLeft=end-scroller.clientWidth+6;
    };
    revealSelected();
    const observer=new ResizeObserver(revealSelected);observer.observe(rail);observer.observe(navigation);
    return()=>observer.disconnect();
  },[workspace,activeSection,sections.length]);

  return <nav className="admin-navigation" data-workspace={workspace} aria-label="Admin navigation">
    <div className="ui-tabs admin-workspaces" role="group" aria-label="Admin workspaces">
      {workspaces.map(({key,label})=><button key={key} type="button" className="ui-tab admin-workspace-tab"
        aria-label={label} title={label} aria-pressed={workspace===key} aria-controls="admin-section-navigation"
        onClick={()=>onWorkspaceChange(key)}><span>{label}</span></button>)}
    </div>
    <span key={`connector-${workspace}`} className="admin-navigation-connector" aria-hidden="true"><ChevronRight size={17} /></span>
    <div className="ui-tabs admin-navigation-secondary">
      <div id="admin-section-navigation" className="admin-section-scroll" ref={sectionsRef}
        role="group" aria-label={`${workspaces.find(item=>item.key===workspace)?.label||'Admin'} sections`}>
      <div key={workspace} className="admin-section-list">
        {sections.map(([key,label],index)=><button key={key} type="button" className="ui-tab admin-section-tab"
          style={{'--admin-section-index':index}} aria-pressed={activeSection===key} onClick={()=>onSectionChange(key)}>
          <span>{label}</span>
        </button>)}
      </div>
      </div>
      {actions && <div className="admin-navigation-actions">{actions}</div>}
    </div>
  </nav>;
}
