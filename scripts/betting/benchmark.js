// Read-only HTTP load probe. This measures the requested host, not its maximum
// player capacity; run against the deployment host to include its RAM/CPU limits.
const options={baseUrl:'http://127.0.0.1:5173',seasonId:null,concurrency:5,requests:100};
try {
  const flags={'--base-url':'baseUrl','--season-id':'seasonId','--concurrency':'concurrency','--requests':'requests'};
  const args=process.argv.slice(2);
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--help'){console.log('Usage: npm run betting:benchmark -- --season-id id [--base-url http://127.0.0.1:5173] [--concurrency 5] [--requests 100]');process.exit(0);}
    const key=flags[args[i]],value=args[++i];if(!key||!value)throw new Error('Unknown option or missing value');options[key]=key==='baseUrl'?value:Number(value);
  }
  if(!Number.isSafeInteger(options.seasonId)||options.seasonId<=0)throw new Error('Select a valid season');
  if(!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>50)throw new Error('Concurrency must be between 1 and 50');
  if(!Number.isInteger(options.requests)||options.requests<1||options.requests>5000)throw new Error('Requests must be between 1 and 5000');
  const base=new URL(options.baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('Use an HTTP URL without credentials');
  const results=[],statuses={};let cursor=0,failed=0;const started=performance.now();
  await Promise.all(Array.from({length:Math.min(options.concurrency,options.requests)},async()=>{
    while(cursor<options.requests) {
      const index=cursor++,view=['series','player','team'][index%3];const start=performance.now();
      try {
        const url=new URL('/api/betting/markets',base);url.search=new URLSearchParams({seasonId:options.seasonId,view});
        const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'}),body=await response.text();
        const payload=JSON.parse(body);if(!response.ok||!Array.isArray(payload.markets))throw new Error(`HTTP ${response.status}`);
        statuses[response.status]=(statuses[response.status]||0)+1;
        results.push({ms:performance.now()-start,bytes:Buffer.byteLength(body),view,
          empty:!(payload.markets.length||payload.players?.length||payload.teamGroups?.length)});
      }catch{failed++;}
    }
  }));
  const seconds=(performance.now()-started)/1000,latencies=results.map(r=>r.ms).sort((a,b)=>a-b);
  const percentile=p=>latencies.length?Math.round(latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*p)-1)]):null;
  console.log(JSON.stringify({target:base.origin,seasonId:options.seasonId,concurrency:options.concurrency,requests:options.requests,
    succeeded:results.length,failed,statuses,elapsedSeconds:+seconds.toFixed(2),successfulRequestsPerSecond:+(results.length/seconds).toFixed(1),
    latencyMs:{p50:percentile(.5),p95:percentile(.95),max:percentile(1)},
    responseBytes:{average:results.length?Math.round(results.reduce((n,r)=>n+r.bytes,0)/results.length):0,max:Math.max(0,...results.map(r=>r.bytes))},
    emptyResponses:results.filter(r=>r.empty).length,
    note:'Read-only market requests. Empty seasons underestimate real load. Monitor server RSS/CPU and database latency on the target host; this is not a maximum-player estimate.'},null,2));
  if(failed)process.exitCode=1;
}catch(error){console.error(`Betting benchmark failed: ${error.message}`);process.exitCode=1;}
