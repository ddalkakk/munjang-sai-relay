const $ = id => document.getElementById(id);
const roomId = new URLSearchParams(location.search).get('room');
const brand = '컴남 릴레이 소설';
let draftRev = null, user = null, lastUser = null, state = null, mode = 'login', intent = '', timer;
let serverRooms = [], landscapeDrawn = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function toast(text) {
  const box = $('notice');
  box.textContent = '';
  void box.offsetWidth;
  box.textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => { box.textContent = ''; }, 3500);
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
}

function getLocalHistory() {
  const map = new Map();
  try {
    const list = JSON.parse(localStorage.getItem('relay-history') || '[]');
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item?.id && item.title) map.set(item.id, item);
      }
    }
  } catch {}
  try {
    const legacy = JSON.parse(localStorage.getItem('relay-recent'));
    if (legacy?.id && legacy.title && !map.has(legacy.id)) {
      map.set(legacy.id, { id: legacy.id, title: legacy.title, updatedAt: 0 });
    }
  } catch {}
  return [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function saveLocalHistory(item) {
  if (!item?.id || !item.title) return;
  const list = getLocalHistory().filter(r => r.id !== item.id);
  const next = [{ id: item.id, title: item.title, updatedAt: item.updatedAt || Date.now() }, ...list].slice(0, 50);
  try {
    localStorage.setItem('relay-history', JSON.stringify(next));
    localStorage.setItem('relay-recent', JSON.stringify({ id: item.id, title: item.title }));
  } catch {}
}

function mergedHistory() {
  const map = new Map();
  for (const item of [...serverRooms, ...getLocalHistory()]) {
    if (!item?.id || !item.title) continue;
    const prev = map.get(item.id);
    if (!prev || (item.updatedAt || 0) > (prev.updatedAt || 0)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function api(data, id) {
  const headers = { 'Content-Type': 'application/json' };
  const legacy = localStorage.getItem('relay-key');
  if (id && legacy) headers['X-Legacy-Key'] = legacy;
  const r = await fetch('/api/room' + (id ? '?id=' + encodeURIComponent(id) : ''), {
    method: data ? 'POST' : 'GET',
    headers,
    body: data && JSON.stringify(data),
    cache: 'no-store'
  });
  let v = {};
  try { v = await r.json(); } catch {}
  if (!r.ok) throw Error(v.error || '잠시 후 다시 시도해 주세요.');
  return v;
}

function setTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  $('theme').setAttribute('aria-pressed', String(dark));
}
setTheme(
  localStorage.getItem('theme')
    ? localStorage.getItem('theme') === 'dark'
    : matchMedia('(prefers-color-scheme:dark)').matches
);
$('theme').onclick = () => {
  const dark = !document.documentElement.classList.contains('dark');
  setTheme(dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
};

function authMode(value) {
  mode = value;
  const reg = mode === 'register';
  $('login').setAttribute('aria-pressed', String(!reg));$('register').setAttribute('aria-pressed', String(reg));
  const pw = $('credentials').elements.password;
  pw.autocomplete = reg ? 'new-password' : 'current-password';
  pw.minLength = reg ? 8 : 1;
  $('hint').textContent = reg
    ? '집필에 사용할 이름과 8자 이상의 비밀번호를 정하세요.'
    : '가입할 때 사용한 이름과 비밀번호를 입력하세요.';
  $('submitAuth').textContent = reg ? '계정 만들고 로그인' : '로그인';
  $('error').textContent = '';
}

function dialog(part) {
  for (const k of ['auth', 'create', 'profile']) $(k).hidden = k !== part;
  $('heading').textContent = { auth: '작가 계정', create: '새 집필실', profile: '내 계정' }[part];
  $('error').textContent = '';
  if (part === 'auth') authMode('login');
  if (!$('modal').open)$('modal').showModal();
}

$('modal').onclose = () => {
  const pw = $('credentials').elements.password;
  pw.value = '';
  pw.type = 'password';
  $('showpw').textContent = '보기';
  intent = '';
};
$('modal').addEventListener('click', e => {
  if (e.target === $('modal'))$('modal').close();
});
$('close').onclick = () => $('modal').close();$('showpw').onclick = () => {
  const p = $('credentials').elements.password;
  p.type = p.type === 'password' ? 'text' : 'password';
  $('showpw').textContent = p.type === 'password' ? '보기' : '숨기기';
};
$('login').onclick = () => authMode('login');$('register').onclick = () => authMode('register');

function showUser() {
  $('account').textContent = user || '로그인';
  $('who').textContent = user ? user + ' 님으로 로그인했어요.' : '';
}
$('account').onclick = () => { intent = ''; dialog(user ? 'profile' : 'auth'); };
$('new').onclick = () => { intent = 'create'; dialog(user ? 'create' : 'auth'); };

function bindCounter(textarea, counterId) {
  const counter = $(counterId);
  if (!textarea || !counter) return;
  const update = () => { counter.textContent = textarea.value.length.toLocaleString() + ' / 3,000자'; };
  textarea.addEventListener('input', update);
  update();
}
bindCounter($('create')?.elements.text, 'createCount');
bindCounter($('write')?.elements.text, 'writeCount');

$('write')?.elements.text.addEventListener('input', e => {
  if (!e.target.value) draftRev = null;
  else if (draftRev === null && state) draftRev = state.rev;
});

function draw(s) {
  if (state && s.rev < state.rev) return;
  const same = state && s.rev === state.rev && s.me === state.me && s.reclaim === state.reclaim && lastUser === user;
  const prevLen = state ? state.paragraphs.length : s.paragraphs.length;
  state = s;
  lastUser = user;
  if (same) return;

  $('title').textContent = s.title;
  document.title = s.title + ' · ' + brand;
  if (s.me >= 0) saveLocalHistory({ id: s.id, title: s.title, updatedAt: Date.now() });

  $('story').replaceChildren(...s.paragraphs.map((p, i) => {
    const section = el('section', '');
    if (i >= prevLen) section.classList.add('is-new');
    section.append(el('small', (i + 1) + '번째 문단 · ' + p.name), el('p', p.text));
    return section;
  }));

  $('people').replaceChildren(...s.people.map((p, i) => {
    const current = s.started && s.turn === i;
    const li = el('li', p + (i === s.me ? ' (나)' : '') + (current ? ' · 집필 중' : ''));
    li.classList.toggle('current', current);
    return li;
  }));

  $('status').textContent = s.started
    ? s.people[s.turn] + ' 님이 이어 쓸 차례예요. (총 ' + s.people.length + '명 참여 중)'
    : s.people.length + '명 참여 중 · 친구를 더 초대하거나, 2명 이상 모이면 시작할 수 있어요.';
  $('join').hidden = s.me >= 0;
  $('join').textContent = !user
    ? '로그인하고 참여하기'
    : s.reclaim
      ? '기존 참여 기록 연결'
      : s.started
        ? '중간에 참여하기'
        : '집필에 참여하기';
  $('start').hidden = !user || s.started || s.me !== 0 || s.people.length < 2;
  $('write').hidden = !user || !s.started || s.turn !== s.me;
}

async function refresh() {
  try { draw(await api(null, roomId)); }
  catch (e) { if (!state) $('status').textContent = e.message; }
}

async function run(button, fn) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '처리 중…';
  try { await fn(); }
  catch (e) {
    if ($('modal').open)$('error').textContent = e.message;
    else toast(e.message);
  }
  finally {
    if (button.textContent === '처리 중…') button.textContent = original;
    button.disabled = false;
  }
}

$('credentials').onsubmit = e => {
  e.preventDefault();
  run($('submitAuth'), async () => {
    const v = await api({ action: mode, ...Object.fromEntries(new FormData(e.target)) });
    user = v.name;
    if (Array.isArray(v.rooms)) serverRooms = v.rooms;
    showUser();
    e.target.elements.password.value = '';
    if (intent === 'create') { dialog('create'); return; }
    const join = intent === 'join';
    $('modal').close();
    if (roomId) {
      if (join) {
        draw(await api({ action: 'join' }, roomId));
        toast('집필에 참여했어요.');
        return;
      }
      await refresh();
    } else {
      renderHome();
    }
    toast('로그인했어요.');
  });
};

$('logout').onclick = () => run($('logout'), async () => {
  await api({ action: 'logout' });
  location.reload();
});

$('create').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const v = await api({ action: 'create', ...Object.fromEntries(new FormData(e.target)) });
    saveLocalHistory({ id: v.id, title: v.title, updatedAt: Date.now() });
    location.href = '/?room=' + v.id;
  });
};

$('join').onclick = () => {
  if (!user) { intent = 'join'; dialog('auth'); return; }
  run($('join'), async () => {
    draw(await api({ action: 'join' }, roomId));
    toast('집필에 참여했어요.');
  });
};

$('start').onclick = () => run($('start'), async () => draw(await api({ action: 'start' }, roomId)));

$('write').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const v = await api({ action: 'write', text: e.target.elements.text.value, rev: draftRev ?? state.rev }, roomId);
    draftRev = null;
    e.target.reset();
    if ($('writeCount'))$('writeCount').textContent = '0 / 3,000자';
    draw(v);
    toast('다음 작가에게 차례를 넘겼어요.');
  });
};

$('invite').onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('초대 링크를 복사했어요.');
  } catch {
    $('link').hidden = false;
    $('link').value = location.href;
    $('link').select();
  }
};

// A two-ink landscape print for the manuscript jacket (HiDPI sharp).
function drawLandscape() {
  if (landscapeDrawn) return;
  const c = $('landscape');
  if (!c) return;
  const w = 600, h = 360, scale = 2;
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext('2d');
  if (!g) return;
  landscapeDrawn = true;
  g.scale(scale, scale);

  g.fillStyle = '#e3dbbe';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#bb5945';
  g.beginPath();
  g.arc(416, 100, 52, 0, Math.PI * 2);
  g.fill();

  for (let layer = 0; layer < 4; layer++) {
    const height = x => 158 + layer * 48 + Math.sin(x / 116 + layer * 2.3) * 33 + Math.sin(x / 64 + layer * 0.7) * 15 + Math.cos(x / 33 + layer) * 4;
    g.beginPath();
    g.moveTo(0, height(0));
    for (let x = 0; x <= w; x += 2) g.lineTo(x, height(x));
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fillStyle = ['#aab5a0', '#758e80', '#4d7167', '#284e49'][layer];
    g.fill();

    g.save();
    g.clip();
    g.lineWidth = 0.85;
    g.strokeStyle = layer < 2 ? '#f4ead078' : '#ece5c978';
    for (let j = 1; j < 54; j++) {
      g.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const y = height(x) + j * 4.7 + Math.sin(x / 40 + j * 0.29) * j * 0.27;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }

  let seed = 171;
  const rand = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 18000; i++) {
    g.fillStyle = i % 2 ? '#48351c16' : '#fff9e324';
    g.fillRect(rand() * w, rand() * h, 1, 1);
  }
}

function renderHome() {
  const list = mergedHistory();
  const content = $('recent');
  const count = $('shelfCount');
  const historyBox = $('history');
  const historyList = $('historyList');

  content.replaceChildren();
  historyList.replaceChildren();

  if (list.length) {
    count.textContent = '총 ' + list.length + '편';
    count.hidden = false;

    const latest = list[0];
    const dateText = formatDate(latest.updatedAt);
    content.append(el('span', dateText ? '가장 최근 원고 · ' + dateText : '가장 최근 원고', 'tag'));
    content.append(el('h3', latest.title));
    const link = el('a', '원고 열기');
    link.href = '/?room=' + encodeURIComponent(latest.id);
    content.append(link);

    const rest = list.slice(1);
    historyBox.hidden = !rest.length;
    for (const item of rest) {
      const li = el('li');
      const a = el('a', '', 'history-card');
      a.href = '/?room=' + encodeURIComponent(item.id);
      const meta = el('div', '', 'history-meta');
      meta.append(el('span', item.title, 'history-name'));
      const d = formatDate(item.updatedAt);
      if (d) meta.append(el('span', '최근 활동 · ' + d, 'history-date'));
      a.append(meta, el('span', '→', 'history-arrow'));
      li.append(a);
      historyList.append(li);
    }
  } else {
    count.hidden = true;
    historyBox.hidden = true;
    content.append(
      el('h3', '아직 집필 중인 원고가 없어요.'),
      el('p', '새 집필실에서 첫 문단을 쓰거나 친구가 보낸 초대 링크로 참여하세요.')
    );
  }
  drawLandscape();
}

// 1. 화면 전환 및 홈 UI는 서버 응답을 기다리지 않고 즉시 렌더링
$('home').hidden = !!roomId;
$('room').hidden = !roomId;
if (!roomId) renderHome();

// 2. 세션 확인 및 방 동기화는 비동기로 실행
(async () => {
  try {
    const info = await api();
    user = info.name;
    if (Array.isArray(info.rooms)) serverRooms = info.rooms;
    showUser();
    if (!roomId) renderHome();
  } catch (e) {
    toast(e.message);
  }
  if (roomId) {
    await refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 3500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
})();
