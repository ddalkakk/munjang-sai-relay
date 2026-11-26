const $=id=>document.getElementById(id);
const roomId=new URLSearchParams(location.search).get('room');
const brand='컴남 릴레이 소설';
let draftRev=null,user=null,state=null,mode='login',intent='',timer;
function el(tag,text){const node=document.createElement(tag);node.textContent=text;return node}
function toast(text){$('notice').textContent=text;clearTimeout(timer);timer=setTimeout(()=>$('notice').textContent='',3500)}
async function api(data,id){
 const headers={'Content-Type':'application/json'},legacy=localStorage.getItem('relay-key');
 if(id&&legacy)headers['X-Legacy-Key']=legacy;
 const r=await fetch('/api/room'+(id?'?id='+encodeURIComponent(id):''),{method:data?'POST':'GET',headers,body:data&&JSON.stringify(data),cache:'no-store'});
 const v=await r.json();if(!r.ok)throw Error(v.error||'다시 시도해 주세요.');return v
}
function setTheme(dark){document.documentElement.classList.toggle('dark',dark);$('theme').setAttribute('aria-pressed',String(dark))}
setTheme(localStorage.getItem('theme')?localStorage.getItem('theme')==='dark':matchMedia('(prefers-color-scheme:dark)').matches);
$('theme').onclick=()=>{const dark=!document.documentElement.classList.contains('dark');setTheme(dark);localStorage.setItem('theme',dark?'dark':'light')};
function authMode(value){
 mode=value;const reg=mode==='register';
 $('login').setAttribute('aria-pressed',String(!reg));$('register').setAttribute('aria-pressed',String(reg));
 const pw=$('credentials').elements.password;pw.autocomplete=reg?'new-password':'current-password';pw.minLength=reg?8:1;
 $('hint').textContent=reg?'집필에 사용할 이름과 8자 이상의 비밀번호를 정하세요.':'가입할 때 사용한 이름과 비밀번호를 입력하세요.';
 $('submitAuth').textContent=reg?'계정 만들고 로그인':'로그인';$('error').textContent=''
}
function dialog(part){
 for(const k of ['auth','create','profile'])$(k).hidden=k!==part;
 $('heading').textContent={auth:'작가 계정',create:'새 집필실',profile:'내 계정'}[part];$('error').textContent='';
 if(part==='auth')authMode('login');
 if(!$('modal').open)$('modal').showModal()
}
$('modal').onclose=()=>{const pw=$('credentials').elements.password;pw.value='';pw.type='password';$('showpw').textContent='보기';intent=''};
$('close').onclick=()=>$('modal').close();
$('showpw').onclick=()=>{const p=$('credentials').elements.password;p.type=p.type==='password'?'text':'password';$('showpw').textContent=p.type==='password'?'보기':'숨기기'};
$('login').onclick=()=>authMode('login');$('register').onclick=()=>authMode('register');
function showUser(){ $('account').textContent=user||'로그인';$('who').textContent=user?user+' 님으로 로그인했어요.':'' }
$('account').onclick=()=>{intent='';dialog(user?'profile':'auth')};
$('new').onclick=()=>{intent='create';dialog(user?'create':'auth')};
function draw(s){
 if(state&&s.rev<state.rev)return;
 state=s;$('title').textContent=s.title;document.title=s.title+' · '+brand;
 if(s.me>=0)localStorage.setItem('relay-recent',JSON.stringify({id:s.id,title:s.title}));
 $('story').replaceChildren(...s.paragraphs.map((p,i)=>{const section=el('section','');section.append(el('small',(i+1)+'번째 문단 · '+p.name),el('p',p.text));return section}));
 $('people').replaceChildren(...s.people.map((p,i)=>{const current=s.started&&s.turn===i;const li=el('li',p+(i===s.me?' (나)':'')+(current?' · 집필 중':''));li.classList.toggle('current',current);return li}));
 $('status').textContent=s.started?s.people[s.turn]+' 님이 이어 쓸 차례예요.':s.people.length+'명 참여 중 · 두 명 이상 모이면 시작할 수 있어요.';
 $('join').hidden=s.me>=0||(s.started&&!s.reclaim);$('join').textContent=!user?'로그인하고 참여하기':s.reclaim?'기존 참여 기록 연결':'집필에 참여하기';
 $('start').hidden=!user||s.started||s.me!==0||s.people.length<2;$('write').hidden=!user||!s.started||s.turn!==s.me
}
async function refresh(){try{draw(await api(null,roomId))}catch(e){if(!state)$('status').textContent=e.message}}
async function run(button,fn){
 button.disabled=true;const original=button.textContent;button.textContent='처리 중…';
 try{await fn()}catch(e){if($('modal').open)$('error').textContent=e.message;else toast(e.message)}
 finally{if(button.textContent==='처리 중…')button.textContent=original;button.disabled=false}
}
$('credentials').onsubmit=e=>{e.preventDefault();run($('submitAuth'),async()=>{
  const v=await api({action:mode,...Object.fromEntries(new FormData(e.target))});user=v.name;showUser();e.target.elements.password.value='';
  if(intent==='create'){dialog('create');return}
  const join=intent==='join';$('modal').close();if(roomId){if(join)draw(await api({action:'join'},roomId));else await refresh()}toast('로그인했어요.')
})};
$('logout').onclick=()=>run($('logout'),async()=>{await api({action:'logout'});location.reload()});
$('create').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const v=await api({action:'create',...Object.fromEntries(new FormData(e.target))});location.href='/?room='+v.id})};
$('join').onclick=()=>{if(!user){intent='join';dialog('auth');return}run($('join'),async()=>draw(await api({action:'join'},roomId)))};
$('start').onclick=()=>run($('start'),async()=>draw(await api({action:'start'},roomId)));
$('write').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const v=await api({action:'write',text:e.target.elements.text.value,rev:draftRev??state.rev},roomId);draftRev=null;e.target.reset();draw(v);toast('다음 작가에게 차례를 넘겼어요.')})};
$('invite').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('초대 링크를 복사했어요.')}catch{$('link').hidden=false;$('link').value=location.href;$('link').select()}};
$('home').hidden=!!roomId;$('room').hidden=!roomId;
try{user=(await api()).name;showUser()}catch(e){toast(e.message)}
if(roomId){await refresh();setInterval(()=>{if(!document.hidden)refresh()},3500);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()})}
else{let recent;try{recent=JSON.parse(localStorage.getItem('relay-recent'))}catch{}if(recent){const a=el('a',recent.title);a.href='/?room='+encodeURIComponent(recent.id);$('recent').append(a)}else $('recent').append(el('p','참여한 집필실이 여기에 표시돼요.'))}
