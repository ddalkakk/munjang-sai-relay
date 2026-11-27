import {randomUUID,createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,readdir} from 'node:fs/promises';
const dir=new URL('../.data/',import.meta.url);
const roomUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
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
  await mkdir(dir,{recursive:true});
  if(old===null){
    try{await writeFile(new URL(record.id+'.json',dir),JSON.stringify(record),{flag:'wx'})}
    catch(e){if(e.code==='EEXIST')fail(409,'이미 등록된 항목이에요.');throw e}
    return
  }
  const tmp=new URL(record.id+'.tmp',dir);
  await writeFile(tmp,JSON.stringify(record));await rename(tmp,new URL(record.id+'.json',dir))
}
async function mutateRoom(id,cloud,fn){
  for(let attempt=0;attempt<3;attempt++){
    const r=await load(id,cloud);
    if(!r?.story?.people)fail(404,'방을 찾을 수 없어요.');
    const changed=fn(r);
    if(!changed)return r;
    const old=r.rev++;
    try{
      await save(r,old,cloud);
      return r;
    }catch(e){
      if(e.status===409&&attempt<2){
        await new Promise(ok=>setTimeout(ok,150*(attempt+1)));
        continue;
      }
      throw e;
    }
  }
}

const queues=new Map();
async function locked(key,fn){
  const pending=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);
  queues.set(key,pending);
  try{return await pending}finally{if(queues.get(key)===pending)queues.delete(key)}
}
function privateId(type,key){
  const h=hash(type+':'+key);
  return [h.slice(0,8),h.slice(8,12),'8'+h.slice(13,16),'a'+h.slice(17,20),h.slice(20,32)].join('-')
}
const derive=(password,salt)=>new Promise((resolve,reject)=>scrypt(password,salt,64,(e,k)=>e?reject(e):resolve(k)));
function cookie(res,value,age){
  res.setHeader('Set-Cookie','relay_session='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+(process.env.VERCEL?'; Secure':''))
}
function mergeRoomLists(a,b){
  const map=new Map();
  for(const item of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])]){
    if(!item?.id||!item.title)continue;
    const prev=map.get(item.id);
    if(!prev||(item.updatedAt||0)>(prev.updatedAt||0))map.set(item.id,item);
  }
  return [...map.values()].sort((x,y)=>(y.updatedAt||0)-(x.updatedAt||0)).slice(0,50);
}
async function scanUserRooms(userId,cloud){
  const found=[];
  try{
    if(process.env.BLOB_READ_WRITE_TOKEN){
      const {list}=await import('@vercel/blob');
      const targets=[];
      let cursor;
      do{
        const res=await list({prefix:'rooms/',cursor,limit:1000});
        for(const b of res.blobs){
          const m=b.pathname.match(/^rooms\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.json$/);
          if(m)targets.push({id:m[1],ts:new Date(b.uploadedAt).getTime()||0});
        }
        cursor=res.hasMore?res.cursor:undefined;
      }while(cursor);
      const records=await Promise.all(targets.map(async({id,ts})=>{
        try{
          const r=await load(id,cloud);
          if(Array.isArray(r?.story?.people)&&r.story.people.some(p=>p.account===userId)){
            return {id:r.id,title:r.story.title,updatedAt:ts};
          }
        }catch{}
        return null;
      }));
      for(const item of records)if(item)found.push(item);
    }else if(cloud){
      const rows=await remote('?select=id,story');
      for(const r of rows){
        if(roomUuid.test(r.id)&&Array.isArray(r?.story?.people)&&r.story.people.some(p=>p.account===userId)){
          found.push({id:r.id,title:r.story.title,updatedAt:0});
        }
      }
    }else{
      const entries=await readdir(dir).catch(()=>[]);
      for(const name of entries){
        const m=name.match(/^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.json$/);
        if(!m)continue;
        try{
          const r=await load(m[1],false);
          if(Array.isArray(r?.story?.people)&&r.story.people.some(p=>p.account===userId)){
            found.push({id:r.id,title:r.story.title,updatedAt:0});
          }
        }catch{}
      }
    }
  }catch{}
  return found;
}
async function getUserRooms(userId,cloud){
  const account=await load(userId,cloud);
  if(!account?.story)return [];
  const existing=Array.isArray(account.story.rooms)?account.story.rooms:[];
  if(account.story.backfilled)return existing;
  const scanned=await scanUserRooms(userId,cloud);
  const merged=mergeRoomLists(existing,scanned);
  try{
    await locked(userId,async()=>{
      const fresh=await load(userId,cloud);
      if(!fresh?.story)return;
      fresh.story.rooms=mergeRoomLists(fresh.story.rooms,merged);
      fresh.story.backfilled=true;
      const old=fresh.rev++;
      await save(fresh,old,cloud);
    });
  }catch{}
  return merged;
}
async function rememberRoom(userId,room,cloud){
  try{
    await locked(userId,async()=>{
      const record=await load(userId,cloud);
      if(!record?.story)return;
      record.story.rooms=mergeRoomLists([{id:room.id,title:room.title,updatedAt:Date.now()}],record.story.rooms);
      const old=record.rev++;
      await save(record,old,cloud);
    });
  }catch{}
}
async function authenticate(data,res,cloud){
  const name=field(data.name,20).normalize('NFC'),pw=data.password;
  if(typeof pw!=='string'||!pw.length||pw.length>128)fail(400,'비밀번호를 확인해 주세요.');
  const id=privateId('account',name.toLowerCase());
  return locked(id,async()=>{
    let record=await load(id,cloud);
    if(data.action==='register'){
      if(pw.length<8)fail(400,'비밀번호는 8자 이상 입력해 주세요.');
      if(record)fail(409,'이미 등록된 이름이에요.');
      const salt=randomBytes(16).toString('hex');
      record={id,rev:1,story:{name,salt,digest:(await derive(pw,salt)).toString('hex'),rooms:[],backfilled:true}};
      await save(record,null,cloud)
    }else{
      const a=record?.story;
      if(a?.retryAfter>Date.now())fail(429,'5분 뒤 다시 시도해 주세요.');
      const k=await derive(pw,a?.salt||'relay-login-fallback');
      if(!a||!timingSafeEqual(k,Buffer.from(a.digest,'hex'))){
        if(a){a.failures=(a.failures||0)+1;if(a.failures>=8){a.retryAfter=Date.now()+300000;a.failures=0}const rev=record.rev++;await save(record,rev,cloud)}
        fail(401,'이름 또는 비밀번호를 확인해 주세요.')
      }
      if(a.failures||a.retryAfter){a.failures=0;a.retryAfter=0;const rev=record.rev++;await save(record,rev,cloud)}
    }
    const secret=randomBytes(32).toString('hex'),age=604800;
    await save({id:privateId('session',secret),rev:1,story:{user:{id,name:record.story.name},expires:Date.now()+age*1000}},null,cloud);
    cookie(res,secret,age);
    const rooms=record.story.backfilled?(record.story.rooms||[]):await getUserRooms(id,cloud);
    return {name:record.story.name,rooms}
  })
}
function view(r,user,legacy){
  const {people,...story}=r.story;
  return {id:r.id,rev:r.rev,...story,people:people.map(p=>p.name),me:user?people.findIndex(p=>p.account===user.id):-1,
    reclaim:!!legacy&&people.some(p=>!p.account&&p.key===hash(legacy))}
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  try{
    const cloud=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
    if(process.env.VERCEL&&!cloud&&!process.env.BLOB_READ_WRITE_TOKEN)fail(503,'저장소 연결을 확인해 주세요.');
    const id=new URL(req.url,'http://localhost').searchParams.get('id');
    if(id&&!roomUuid.test(id))fail(404,'방을 찾을 수 없어요.');
    let data={};
    if(req.method==='POST'){
      if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'JSON 요청이 필요해요.');
      try{
        if(req.body!==undefined)data=typeof req.body==='string'?JSON.parse(req.body):req.body;
        else{const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>40000)fail(413,'글이 너무 길어요.');parts.push(part)}data=JSON.parse(Buffer.concat(parts).toString()||'{}')}
      }catch(err){if(err.status)throw err;fail(400,'요청 형식을 확인해 주세요.')}
      if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'요청 형식을 확인해 주세요.');
    }else if(req.method!=='GET')fail(405,'지원하지 않는 요청이에요.');
    if(['register','login'].includes(data.action)){res.end(JSON.stringify(await authenticate(data,res,cloud)));return}
    const secret=(req.headers.cookie||'').match(/(?:^|;\s*)relay_session=([0-9a-f]{64})(?:;|$)/)?.[1];
    const session=secret&&await load(privateId('session',secret),cloud);
    const user=session?.story.expires>Date.now()?session.story.user:null;
    if(data.action==='logout'){if(user){session.story.expires=0;const old=session.rev++;await save(session,old,cloud)}cookie(res,'',0);res.end('{}');return}
    if(!id&&req.method==='GET'){
      const rooms=user?await getUserRooms(user.id,cloud):[];
      res.end(JSON.stringify({name:user?.name||null,rooms}));return
    }
    if(req.method==='POST'&&!user)fail(401,'로그인 후 작성할 수 있어요.');
    const legacy=req.headers['x-legacy-key'],key=id||randomUUID();
    const result=await locked(key,async()=>{
      if(!id&&data.action==='create'){
        const {name}=user,title=field(data.title,80),text=field(data.text,3000);
        const r={id:key,rev:1,story:{title,people:[{name,account:user.id}],started:false,turn:0,paragraphs:[{name,text}]}};
        await save(r,null,cloud);return view(r,user,legacy)
      }
      if(req.method==='GET'){
        const r=id&&await load(id,cloud);
        if(!r?.story?.people)fail(404,'방을 찾을 수 없어요.');
        return view(r,user,legacy);
      }
      const r=await mutateRoom(id,cloud,room=>{
        const s=room.story,me=s.people.findIndex(p=>p.account===user.id);
        if(data.action==='join'){
          if(me>=0)return false;
          const prior=legacy&&s.people.find(p=>!p.account&&p.key===hash(legacy));
          if(prior){prior.account=user.id;delete prior.key}
          else{
            if(s.people.some(p=>p.name===user.name))fail(409,'이 방에서 이미 사용 중인 이름이에요.');
            s.people.push({name:user.name,account:user.id})
          }
          return true;
        }
        if(data.action==='start'){
          if(me!==0||s.started||s.people.length<2)fail(409,'두 명 이상 모이면 방장이 시작할 수 있어요.');
          s.started=true;s.turn=1;
          return true;
        }
        if(data.action==='write'){
          if(!s.started||me!==s.turn)fail(409,'현재 집필 차례를 확인해 주세요.');
          if(typeof data.count==='number'?data.count!==s.paragraphs.length:data.rev!==room.rev){
            fail(409,'새 문단이 먼저 등록되었어요. 화면을 확인해 주세요.');
          }
          s.paragraphs.push({name:s.people[me].name,text:field(data.text,3000)});
          s.turn=(me+1)%s.people.length;
          return true;
        }
        fail(400,'지원하지 않는 요청이에요.');
      });
      return view(r,user,legacy);
    });
    if(user&&req.method==='POST'&&['create','join','write'].includes(data.action)){
      await rememberRoom(user.id,result,cloud);
    }
    res.end(JSON.stringify(result))
  }catch(e){res.statusCode=e.status||500;res.end(JSON.stringify({error:e.status?e.message:'요청을 처리하지 못했어요.'}))}
}
