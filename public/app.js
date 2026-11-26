const $=id=>document.getElementById(id);
const id=new URLSearchParams(location.search).get('room');
let token=localStorage.getItem('relay-key');
if(!token){const b=crypto.getRandomValues(new Uint8Array(16));const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');token=[h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');localStorage.setItem('relay-key',token)}
let state,timer;
function tell(message){$('notice').textContent=message;clearTimeout(timer);timer=setTimeout(()=>$('notice').textContent='',5000)}
async function api(data){const r=await fetch('/api/room'+(id?'?id='+encodeURIComponent(id):''),{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data&&JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error);return v}
function el(tag,str){const e=document.createElement(tag);e.textContent=str;return e}
function draw(s){
 if(state&&s.rev<=state.rev)return;state=s;$('title').textContent=s.title;document.title=s.title+' · 문장 사이';
 if(s.me>=0)localStorage.setItem('relay-recent',JSON.stringify({id:s.id,title:s.title}));
 $('story').replaceChildren(...s.paragraphs.map((p,i)=>{const a=el('section','');a.append(el('small',(i+1)+'번째 문단 · '+p.name),el('p',p.text));return a}));
 $('people').replaceChildren(...s.people.map((p,i)=>el('li',p+(i===0?' · 방장':'')+(i===s.me?' (나)':''))));
 $('status').textContent=s.started?(s.people[s.turn]+' 님이 이어 쓸 차례예요.'):(s.people.length+'명 참여 중 · 친구를 기다리고 있어요.');
 $('join').hidden=s.me>=0||s.started;$('start').hidden=s.started||s.me!==0||s.people.length<2;$('write').hidden=!s.started||s.turn!==s.me
}
for(const action of ['create','join','write']){
 const form=$(action);form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;
 try{const s=await api({action,...Object.fromEntries(new FormData(form)),rev:state?.rev});if(action==='create'){location.href='/?room='+s.id;return}draw(s);form.reset()}catch(e){tell(e.message)}finally{button.disabled=false}}
}
$('start').onclick=async()=>{try{draw(await api({action:'start'}))}catch(e){tell(e.message)}};
$('invite').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);tell('초대 링크를 복사했어요.')}catch{$('link').hidden=false;$('link').value=location.href;$('link').select();tell('선택한 초대 링크를 복사해 주세요.')}};
if(id){$('home').hidden=true;$('room').hidden=false;async function refresh(){try{draw(await api())}catch(e){if(!state)$('status').textContent=e.message;else tell(e.message)}}await refresh();setInterval(refresh,2000)}
else{const recent=JSON.parse(localStorage.getItem('relay-recent')||'null');if(recent){const a=el('a','최근 집필실 · '+recent.title);a.href='/?room='+encodeURIComponent(recent.id);$('recent').append(a)}}
