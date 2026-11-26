import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
const dir=new URL('../.data/',import.meta.url);
const hash=s=>createHash('sha256').update(s).digest('hex');
function fail(status,message){throw Object.assign(new Error(message),{status})}
function field(value,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,'입력한 글의 길이를 확인해 주세요.');return value.trim()}
async function remote(query,method='GET',body){
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/relay_rooms'+query,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body&&JSON.stringify(body)});
  if(!r.ok)fail(503,'저장소 연결을 확인해 주세요.');return r.json()
}
async function load(id,cloud){
  if(process.env.BLOB_READ_WRITE_TOKEN){
    const {get}=await import('@vercel/blob');
    const result=await get('rooms/'+id+'.json',{access:'private',useCache:false});
    if(!result)return;
    const record=await new Response(result.stream).json();
    Object.defineProperty(record,'etag',{value:result.blob.etag});
    return record;
  }
  if(cloud)return (await remote('?id=eq.'+id))[0];
  try{return JSON.parse(await readFile(new URL(id+'.json',dir),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
}
async function save(record,old,cloud){
  if(process.env.BLOB_READ_WRITE_TOKEN){
    const {put,BlobPreconditionFailedError}=await import('@vercel/blob');
    const options={access:'private',addRandomSuffix:false,contentType:'application/json'};
    if(old!==null){options.allowOverwrite=true;options.ifMatch=record.etag}
    try{await put('rooms/'+record.id+'.json',JSON.stringify(record),options)}
    catch(error){if(error instanceof BlobPreconditionFailedError)fail(409,'집필실이 변경되었어요. 다시 확인해 주세요.');throw error}
    return;
  }
  if(cloud){const rows=await remote(old===null?'':'?id=eq.'+record.id+'&rev=eq.'+old,old===null?'POST':'PATCH',record);if(!rows.length)fail(409,'방이 변경되었어요. 다시 확인해 주세요.');return}
  await mkdir(dir,{recursive:true});const tmp=new URL(record.id+'.tmp',dir);
  await writeFile(tmp,JSON.stringify(record));await rename(tmp,new URL(record.id+'.json',dir))
}
function view(r,token){
  const {people,...story}=r.story;return {id:r.id,rev:r.rev,...story,people:people.map(p=>p.name),me:people.findIndex(p=>p.key===hash(token))}
}
const queues=new Map();
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const cloud=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
    if(process.env.VERCEL&&!cloud&&!process.env.BLOB_READ_WRITE_TOKEN)fail(503,'공유 저장소 설정이 필요해요.');
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9-]{36}$/.test(token))fail(400,'브라우저에서 방을 다시 열어 주세요.');
    const id=new URL(req.url,'http://localhost').searchParams.get('id');
    if(id&&!/^[a-f0-9-]{36}$/.test(id))fail(404,'방을 찾을 수 없어요.');
    let data={};if(req.method==='POST'){
      if(req.body!==undefined)data=typeof req.body==='string'?JSON.parse(req.body):req.body;
      else {let raw='';for await(const part of req){raw+=part;if(raw.length>40000)fail(413,'글이 너무 길어요.')}data=JSON.parse(raw||'{}')}
    }else if(req.method!=='GET')fail(405,'지원하지 않는 요청이에요.');
    const key=id||randomUUID();
    const run=async()=>{
      if(!id&&req.method==='POST'&&data.action==='create'){
        const name=field(data.name,20),title=field(data.title,80),text=field(data.text,3000);
        const r={id:key,rev:1,story:{title,people:[{name,key:hash(token)}],started:false,turn:0,paragraphs:[{name,text}]}};
        await save(r,null,cloud);return view(r,token)
      }
      const r=id&&await load(id,cloud);if(!r)fail(404,'초대 링크에 해당하는 방을 찾을 수 없어요.');
      if(req.method==='GET')return view(r,token);
      const s=r.story,me=s.people.findIndex(p=>p.key===hash(token));
      if(data.action==='join'){
        if(me>=0)return view(r,token);
        const name=field(data.name,20);if(s.started)fail(409,'이미 집필을 시작한 방이에요.');
        if(s.people.some(p=>p.name===name))fail(409,'이미 사용 중인 필명이에요.');s.people.push({name,key:hash(token)})
      }else if(data.action==='start'){
        if(me!==0||s.started||s.people.length<2)fail(409,'두 명 이상 모이면 방장이 시작할 수 있어요.');s.started=true;s.turn=1
      }else if(data.action==='write'){
        if(!s.started||me!==s.turn||data.rev!==r.rev)fail(409,'현재 집필 차례를 확인해 주세요.');
        s.paragraphs.push({name:s.people[me].name,text:field(data.text,3000)});s.turn=(me+1)%s.people.length
      }else fail(400,'알 수 없는 요청이에요.');
      const old=r.rev++;await save(r,old,cloud);return view(r,token)
    };
    const pending=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(run);queues.set(key,pending);
    try{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(await pending))}finally{if(queues.get(key)===pending)queues.delete(key)}
  }catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.status?e.message:'요청을 처리하지 못했어요.'}))}
}
