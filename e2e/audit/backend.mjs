// Real HTTP, CLI and MCP audit. No provider keys or response substitution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root=process.cwd(), out=path.join(root,'audit/evidence'), work=path.join(root,'e2e/.audit-work');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(work,{recursive:true});
const D='http://127.0.0.1:3101', P='http://127.0.0.1:3102', U='http://127.0.0.1:3103', L='http://127.0.0.1:3104';
const id='00000000-0000-4000-8000-000000000001', unknown='00000000-0000-4000-8000-000000000000';
const body={brand:'Exact listing name',category:'restaurant',city:'Mumbai',personaCount:24};
const qloo='Qloo key not configured: add QLOO_API_KEY to .env.local and restart the server.';
const nebius='Nebius key not configured: add NEBIUS_API_KEY to .env.local to run NVIDIA Nemotron on Nebius.';
const missing=['QLOO_API_KEY','NEBIUS_API_KEY','OPENAI_API_KEY'];
const setup={error:'setup_required',missing,message:missing.map(k=>'Setup required: '+k).join('; ')};
const cases={}, results={}, deps=JSON.parse(fs.readFileSync(path.join(root,'e2e/audit/backend-dependencies.json'),'utf8'));
let log=[];
const note=x=>log.push(typeof x==='string'?x:JSON.stringify(x,null,2));
const add=(ns,fn)=>ns.forEach(n=>cases[n]=fn);
async function http(base,route,init={}){
 const r=await fetch(base+route,init),text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 note(`${init.method||'GET'} ${base}${route}\nHTTP ${r.status}\nHeaders: ${JSON.stringify(Object.fromEntries([...r.headers].filter(([k])=>/^(content-type|x-|retry-after)/.test(k))))}\nBody: ${text}`);
 return {status:r.status,data,headers:r.headers};
}
const token=fs.readFileSync(path.join(root,'e2e/.run/run-token'),'utf8').trim();
const post=(base,route,data=body,headers={})=>http(base,route,{method:'POST',headers:{'content-type':'application/json',...(base===U?{'X-TasteProbe-Run-Token':token}:{}),...headers},body:JSON.stringify(data)});
const check=(r,status,data)=>{assert.equal(r.status,status);if(data!==undefined)assert.deepEqual(r.data,data);};
const gate=async()=>{for(const base of [D,P,U,L])assert.equal((await http(base,'/api/status')).data.gate.runsToday,0);};
const store=path.join(root,'e2e/.run/data-public/audits.json');
async function mutate(fn,run){const original=fs.readFileSync(store);try{const records=JSON.parse(original);fn(records);fs.writeFileSync(store,JSON.stringify(records));await run();}finally{fs.writeFileSync(store,original);}}
const clean={PATH:process.env.PATH,HOME:root,NEXT_TELEMETRY_DISABLED:'1'};
function cmd(command,args=[],extra={}){
 const r=spawnSync(command,args,{cwd:root,env:clean,encoding:'utf8',timeout:120000,...extra});
 note(`Command: ${command} ${args.join(' ')}\nExit code: ${r.status}\nSignal: ${r.signal}\nstdout:\n${r.stdout||''}\nstderr:\n${r.stderr||''}`);if(r.error)throw r.error;return r;
}
const cli=(args,data='data-dev')=>cmd('npm',['run','audit:live','--',...args],{env:{...clean,TASTEPROBE_DATA_DIR:path.join(root,'e2e/.run',data)}});
add([1,3],async()=>{const r=await http(D,'/api/status');check(r,200);assert.equal(r.data.qloo,false);assert.deepEqual(r.data.nebius,{configured:false,ok:false,model:'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',detail:'NEBIUS_API_KEY not set'});assert.deepEqual(r.data.systems,[]);assert.deepEqual(r.data.runs,{locked:false,setupRequired:null,maxPersonas:200,runsPerIpPerHour:10,dailyRuns:100,deadlineSeconds:900,agentCaps:{maxTries:5,maxAssistantCalls:480,maxNemotronTokens:400000,maxTurns:20},oneAtATime:true});assert.equal(r.data.gate.running,null);assert.equal(r.data.gate.runsToday,0);});
add([4],async()=>{for(const base of [D,P]){const r=await http(base,'/api/audits');check(r,200,[]);assert.equal(r.headers.get('x-total-count'),'0');assert.equal(r.headers.get('x-live-count'),'0');assert.equal(r.headers.get('x-featured-audit'),null);}});
add([5],async()=>{for(const [query,count]of [['',12],['?limit=0',1],['?limit=-3',1],['?limit=nope',12],['?limit=1',1],['?limit=99',14],['?offset=-1',12],['?offset=12&limit=12',2]]){const r=await http(U,'/api/audits'+query);check(r,200);assert.equal(r.data.length,count);assert.equal(r.headers.get('x-total-count'),'14');assert.equal(r.headers.get('x-live-count'),'0');assert.equal(r.headers.get('x-featured-audit'),id);if(!query.includes('offset=12'))assert.equal(r.data[0].id,id);for(const s of r.data){assert.equal(typeof s.personas,'number');assert.equal(s.provenance,'synthetic');assert.ok(!('segments'in s));assert.ok(!('qlooSignals'in s));}}await gate();});
add([6,7],async n=>check(await http(D,'/api/audits/'+unknown+(n===7?'?evidence=1':'')),404,{error:'Audit not found.'}));
add([8],async()=>{const r=await http(U,'/api/audits/'+id);check(r,200);assert.equal(r.data.meta.assistants[0].host,'custom endpoint');});
add([9],async()=>{const r=await http(U,'/api/audits/'+id+'?evidence=1');check(r,200);assert.equal(r.data.responses.length,45);assert.equal(r.data.attempt,null);for(const row of r.data.responses)assert.deepEqual(Object.keys(row).sort(),['personaId','segment','model','prompt','answer','entities','brand','listEntities'].sort());});
add([10,74,78,80],async()=>{for(const base of [D,P])check(await post(base,'/api/audits'),503,{error:qloo});await gate();});
add([11,12,13],async n=>{const key={11:'brand',12:'category',13:'city'}[n],message={11:'Enter the business name.',12:'Enter a category.',13:'Enter a city.'}[n];for(const value of ['',' ','x'])check(await post(D,'/api/audits',{...body,[key]:value}),400,{error:message});});
add([14],async()=>{check(await post(D,'/api/audits',{...body,personaCount:7}),400,{error:'Use at least 8 personas (one segment needs 8).'});const {personaCount,...defaults}=body;check(await post(D,'/api/audits',defaults),503,{error:qloo});});
add([15],async()=>{for(const bad of ['{',''])check(await http(D,'/api/audits',{method:'POST',headers:{'content-type':'application/json'},body:bad}),400,{error:'Request body must be JSON.'});});
add([16],async()=>{for(const bad of [null,[],'text',1,true]){const r=await post(D,'/api/audits',bad);check(r,400);assert.match(r.data.error,/Expected object/);}});
add([17],async()=>check(await post(U,'/api/audits',{...body,personaCount:25}),400,{error:'This server allows at most 24 personas per audit (TASTEPROBE_MAX_PERSONAS).',code:'persona_cap',maxPersonas:24}));
add([23],async()=>check(await post(D,'/api/audits/'+unknown+'/fix',{}),404,{error:'Audit not found.'}));
add([24],async()=>check(await post(U,'/api/audits/'+id+'/fix',{segment:'unknown'}),400,{error:'That taste segment is not part of this audit.'}));
add([25],async()=>mutate(a=>{a.find(a=>a.id===id).personas=[];},async()=>check(await post(U,'/api/audits/'+id+'/fix',{segment:'place-keyword'}),400,{error:'This segment has no personas to re-test.'})));
add([26],async()=>check(await post(U,'/api/audits/'+id+'/fix',{segment:'place-keyword'}),503,{error:qloo}));
add([29,103,107,111],async()=>{check(await post(D,'/api/audits/'+unknown+'/agent',{}),503,setup);await gate();});
add([35,37],async n=>check(await http(D,'/api/audits/'+unknown+(n===35?'/fix':'/agent'),{method:'POST',headers:{'content-type':'application/json'},body:'{'}),400,{error:'Request body must be JSON.',code:'invalid_json'}));
add([36,38],async n=>{const route='/api/audits/'+unknown+(n===36?'/fix':'/agent');for(const bad of [null,[],'text',1,true])check(await post(D,route,bad),400,{error:'Request body must be a JSON object.',code:'invalid_body'});for(const empty of ['','   '])check(await http(D,route,{method:'POST',headers:{'content-type':'application/json'},body:empty}),n===36?404:503,n===36?{error:'Audit not found.'}:setup);});
for(const [start,route]of [[39,'/api/audits'],[43,'/api/audits/'+id+'/fix'],[47,'/api/audits/'+id+'/agent']]){
 add([start],async()=>{const r=await post(L,route,{});check(r,503);assert.equal(r.data.code,'setup_required');assert.match(r.data.error,/TASTEPROBE_RUN_TOKEN/);assert.equal((await http(L,'/api/status')).data.runs.setupRequired,'TASTEPROBE_RUN_TOKEN');await gate();});
 add([start+1],async()=>{for(const headers of [{},{cookie:'TASTEPROBE_RUN_TOKEN=not-a-token'}]){const r=await http(U,route,{method:'POST',headers,body:'{}'});check(r,401,{error:'Runs are disabled on this server: it needs the run token (TASTEPROBE_RUN_TOKEN) in the X-TasteProbe-Run-Token header. Stored audits stay open to read.',code:'run_locked'});}await gate();});
 add([start+2],async()=>check(await post(U,route,{}, {'X-TasteProbe-Run-Token':'invalid-audit-input'}),403,{error:'The run token was rejected. Stored audits stay open to read.',code:'run_token_rejected'}));
 add([start+3],async()=>{for(const headers of [{},{'content-type':'text/plain'}])check(await http(D,route,{method:'POST',headers,body:'{}'}),415,{error:'Send the request as JSON (Content-Type: application/json).',code:'json_required'});});
}
let client,transport;
async function connect(){if(client)return client;const cwd=path.join(work,'mcp');fs.mkdirSync(cwd,{recursive:true});transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp/server.mjs')],cwd,env:{...clean,HOME:cwd,TASTEPROBE_DATA_DIR:path.join(cwd,'data')},stderr:'pipe'});client=new Client({name:'tasteprobe-audit',version:'1.0.0'});await client.connect(transport);return client;}
async function tool(name,args){const c=await connect();const r=await c.callTool({name,arguments:args});note({tool:name,args,result:r});return r;}
add([56],async()=>{const c=await connect();assert.deepEqual(c.getServerVersion(),{name:'tasteprobe',version:'1.0.0'});const r=await c.listTools();note(r);assert.deepEqual(r.tools.map(t=>t.name).sort(),['get_report','qloo_taste_profile','run_audit','run_fix']);});
add([57,58],async n=>{const r=await tool(n===57?'run_audit':'run_fix',n===57?{brand:body.brand,city:body.city}:{audit_id:unknown});assert.equal(r.isError,true);assert.deepEqual(r.structuredContent,{error:'setup_required',missing});assert.match(r.content[0].text,/No API call was made/);});
add([62],async()=>{const r=await tool('get_report',{});assert.deepEqual(r.structuredContent,{audits:[]});assert.equal(r.content[0].text,'No audits are stored yet. Run run_audit with live keys first.');});
add([63],async()=>{await connect();const dir=path.join(work,'mcp/data');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'audits.json');try{fs.copyFileSync(store,file);let r=await tool('get_report',{});assert.equal(r.structuredContent.audits.length,14);r=await tool('get_report',{audit_id:id});assert.equal(r.structuredContent.provenance,'synthetic');fs.writeFileSync(file,'invalid JSON for deliberate store failure');r=await tool('get_report',{});assert.equal(r.isError,true);assert.match(r.content[0].text,/Could not read the audit store:/);}finally{fs.rmSync(file,{force:true});}});
add([64],async()=>{const r=await tool('get_report',{audit_id:unknown});assert.equal(r.isError,true);assert.deepEqual(r.structuredContent,{error:'not_found',auditId:unknown});});
add([65,66,67,68],async n=>{const name={65:'run_fix',66:'get_report',67:'qloo_taste_profile',68:'run_audit'}[n];const bad=n===68?[{city:'Mumbai'},{brand:'x',city:'Mumbai'},{brand:'Okay',city:'x'},{brand:'Okay',city:'Mumbai',personas:7},{brand:'Okay',city:'Mumbai',personas:201},{brand:'Okay',city:'Mumbai',personas:8.5}]:[{audit_id:'not-a-uuid',...(n===67?{filter_type:'urn:entity:artist'}:{})}];for(const args of bad){const r=await tool(name,args);assert.equal(r.isError,true);assert.doesNotMatch(r.content[0].text,/Setup required/);}});
add([69,82],async()=>{const r=await tool('qloo_taste_profile',{audit_id:unknown,filter_type:'urn:entity:artist'});assert.equal(r.isError,true);assert.deepEqual(r.structuredContent,{error:'setup_required',missing:['QLOO_API_KEY']});assert.match(r.content[0].text,/No API call was made/);});
add([86,89,92,95,98],async n=>{const code=`import assert from 'node:assert/strict';import * as p from './src/lib/providers.ts';${n===86?"assert.deepEqual(await p.checkNebiusModel(),{ok:false,detail:'NEBIUS_API_KEY not set'});console.log(JSON.stringify(await p.checkNebiusModel()));":n===98?"assert.deepEqual(await p.askAssistants('audit no-key check'),[]);console.log('No configured assistants: []');":`await assert.rejects(()=>p.${{89:"extractEntities('one','restaurant','Mumbai')",92:"suggestContentChange({brand:'Any Venue',category:'restaurant',city:'Mumbai',segment:'one',tastes:[],competitors:[]})",95:"nemotronTurn([],[])"}[n]},e=>e.message===${JSON.stringify(nebius)});console.log(${JSON.stringify(nebius)});`}`;assert.equal(cmd(process.execPath,['--input-type=module','-e',code]).status,0);const r=await http(D,'/api/status');assert.equal(r.data.nebius.configured,false);check(await post(D,'/api/audits'),503,{error:qloo});});
add([112,118,120,122],async()=>{const r=cli(['--brand',body.brand,'--city',body.city]);assert.equal(r.status,1);assert.equal(r.stderr,'Setup required: QLOO_API_KEY\nSetup required: NEBIUS_API_KEY\nSetup required: OPENAI_API_KEY (or MODEL_2_API_KEY, MODEL_2_BASE_URL and MODEL_2_ID)\nAdd the keys to .env.local (see .env.example). No API was called.\n');assert.ok(!r.stdout.includes('Preflight ok'));});
add([113,114],async n=>{const r=cli(n===113?['--city','Mumbai']:['--brand','Any Venue']);assert.equal(r.status,1);assert.match(r.stderr,/^Usage: npm run audit:live/);});
add([115],async()=>{for(const value of ['7','201','8.5','word']){const r=cli(['--brand',body.brand,'--city',body.city,'--personas',value]);assert.equal(r.status,1);assert.equal(r.stderr,'--personas must be a whole number from 8 to 200 (at least 8 per taste segment).\n');}});
add([124],async()=>{const r=cli(['--replay',id],'data-public');assert.equal(r.status,0);assert.match(r.stdout,/Replay of run/);assert.match(r.stdout,/cached answers/);});
add([125],async()=>{const r=cli(['--replay']);assert.equal(r.status,1);assert.equal(r.stderr,'Usage: npm run audit:live -- --replay <run id>\n');});
add([126],async()=>{for(const [which,data,expected]of [[unknown,'data-dev',/No recorded run/],['00000000-0000-4000-8000-000000000100','data-public',/has no cached responses/]]){const r=cli(['--replay',which],data);assert.equal(r.status,1);assert.match(r.stderr,expected);}});
add([127],async()=>{const file=path.join(work,'unwritable-parent');fs.writeFileSync(file,'not a directory');const r=cmd('sh',['scripts/docker-entrypoint.sh','sh','-c','echo SERVER_STARTED'],{env:{...clean,TASTEPROBE_DATA_DIR:file+'/data'}});assert.equal(r.status,1);assert.match(r.stderr,/not writable by uid/);assert.ok(!r.stdout.includes('SERVER_STARTED'));});
add([128],async()=>{const dir=path.join(work,'writable');fs.mkdirSync(dir,{recursive:true});const r=cmd('sh',['scripts/docker-entrypoint.sh','sh','-c','exit 7'],{env:{...clean,TASTEPROBE_DATA_DIR:dir}});assert.equal(r.status,7);});
add([129],async()=>{for(const file of ['Dockerfile','docker-compose.yml','railway.json']){const text=fs.readFileSync(file,'utf8');note(file+'\n'+text);}assert.match(fs.readFileSync('Dockerfile','utf8'),/USER node/);});
add([130,132,134,135,136,137],async n=>{const file={130:'no-mock.txt',132:'build.txt',134:'unit.txt',135:'typecheck.txt',136:'e2e.txt',137:'stack.txt'}[n];const text=fs.readFileSync(path.join(work,file),'utf8');note(text);assert.ok(text.length);assert.ok(!/\b[1-9]\d* failed\b|error TS\d+|Failed to compile/.test(text));if(n===136)assert.match(text,/\d+ passed/);if(n===134)assert.match(text,/(?:ℹ pass|# pass) 155/);if(n===137)assert.match(text,/stack up/);});
add([131],async()=>{assert.equal(JSON.parse(fs.readFileSync('package.json','utf8')).scripts.dev,'next dev');check(await http(D,'/api/status'),200);check(await post(D,'/api/audits'),503,{error:qloo});});
add([133],async()=>{assert.equal(JSON.parse(fs.readFileSync('package.json','utf8')).scripts.start,'next start');check(await http(L,'/api/status'),200);const r=await post(L,'/api/audits');check(r,503);assert.equal(r.data.code,'setup_required');});
add([138],async()=>{const r=cmd('bash',['e2e/stack.sh']);assert.equal(r.status,1);assert.match(r.stderr,/e2e\/\.run\/pids exists/);});
add([139],async()=>{const text=fs.readFileSync(path.join(work,'shutdown.txt'),'utf8');note(text);assert.match(text,/no e2e\/\.run\/pids/);assert.match(text,/3104 closed/);});
add([140],async()=>{const r=cmd('rg',['--files','src','scripts']);assert.equal(r.status,0);assert.ok(!/\.(sol|rs|move)(?:\n|$)/.test(r.stdout));const scan=cmd('rg',['-n','-i','ethers|viem|web3|sendTransaction|sendRawTransaction|eth_send|cardano-cli','src','scripts','package.json']);assert.equal(scan.status,1);});
const skip=process.env.AUDIT_BACKEND_ROWS?.split(',').map(Number);
try{
 for(let n=1;n<=140;n++){
  if(skip&&!skip.includes(n))continue;
  const key='B-'+String(n).padStart(3,'0');log=[];let status='PASS',detail='Real HTTP/CLI/MCP or specified command/source checks passed; no external provider call.';
  try{
   if(cases[n])await cases[n](n);
   if(deps[key]&&![63,86,98].includes(n)){status='UNTESTED';detail=deps[key].replace(/assistant key/g,'OPENAI_API_KEY or complete MODEL_2_* assistant slot');note('Dependency inventory: QLOO_API_KEY, NEBIUS_API_KEY, OPENAI_API_KEY and MODEL_2_* are absent from the clean execution environment.');}
   else if(!cases[n])throw new Error('No executable scenario or dependency recorded');
  }catch(e){status='FAIL';detail=String(e.stack||e);}
  fs.writeFileSync(path.join(out,key+'.txt'),`${key}\nStatus: ${status}\n${detail}\n\n${log.join('\n\n')}\n`);
  results[key]={status,detail};console.log(key,status,detail.split('\n')[0]);
 }
}finally{if(client){const pid=transport.pid;await client.close();note('Closed MCP child PID '+pid);}}
fs.writeFileSync(path.join(out,'backend-results'+(skip?'-targeted':'')+'.json'),JSON.stringify(results,null,2));
