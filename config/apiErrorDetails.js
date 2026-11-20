import {STATUS_CODES} from 'node:http';

const methods=new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
// Mounts are application constants. Dynamic mount segments never enter analytics.
const mounts=new Set(['api','admin','analytics','betting','signup','inhouses','rosters','matches','seasons','signups','draftgod','league-overview','match-records','schedule']);
const labels={401:'Sign-in required',403:'Access denied',404:'Not found',409:'Conflict',413:'Payload too large',422:'Invalid request content',429:'Too many requests'};

export const apiErrorLabel=status=>labels[status]||STATUS_CODES[status]||'HTTP error';

export function apiErrorContext(req) {
  const method=methods.has(req.method)?req.method:'OTHER';
  const base='/'+String(req.baseUrl||'').split('/').filter(Boolean).slice(0,12).map(segment=>mounts.has(segment)?segment:':id').join('/');
  const prefix=base.startsWith('/api/')||base==='/api'?base:'/api';
  const pattern=req.route?.path;
  const route=typeof pattern==='string'?(pattern.startsWith('/api/')?pattern:prefix+pattern)
    :`${prefix}/${req.route?'[pattern]':req.res?.statusCode===404?'[unmatched]':'[middleware]'}`;
  return safeApiErrorContext({method,route});
}

export function safeApiErrorContext(details) {
  const method=methods.has(details?.method)?details.method:'OTHER';
  const route=typeof details?.route==='string'&&details.route.startsWith('/api/')&&details.route.length<=240
    &&!/[?#\s|\u0000-\u001f]/.test(details.route)?details.route:'/api/[unknown]';
  return {method,route};
}
