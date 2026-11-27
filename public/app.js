const $ = id => document.getElementById(id);
const roomId = new URLSearchParams(location.search).get('room');
const brand = '컴남 릴레이 소설';
let user = null, lastUser = null, authChecked = false, state = null, mode = 'login', intent = '', timer;
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

function getRoomToken(id) {
  try { return localStorage.getItem('relay-token-' + id) || ''; } catch { return ''; }
}
function saveRoomToken(id, token) {
  try {
    if (token) localStorage.setItem('relay-token-' + id, token);
    else localStorage.removeItem('relay-token-' + id);
  } catch {}
}

function historyKey() {
  return user ? 'relay-history:' + user : '';
}

function clearBrowserSecrets() {
  try {
    localStorage.removeItem('relay-history');
    localStorage.removeItem('relay-recent');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('relay-token-') || k.startsWith('relay-history:'))) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

function getLocalHistory() {
  const key = historyKey();
  if (!key) return [];
  const map = new Map();
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item?.id && item.title) map.set(item.id, item);
      }
    }
  } catch {}
  return [...map.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function saveLocalHistory(item) {
  const key = historyKey();
  if (!key || !item?.id || !item.title) return;
  const list = getLocalHistory().filter(r => r.id !== item.id);
  const next = [{ id: item.id, title: item.title, updatedAt: item.updatedAt || Date.now() }, ...list].slice(0, 50);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

function removeLocalHistory(targetId) {
  const key = historyKey();
  if (!key) return;
  const next = getLocalHistory().filter(r => r.id !== targetId);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

function mergedHistory() {
  if (!user) return [];
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
  if (id) {
    const token = getRoomToken(id);
    if (token) headers['X-Room-Token'] = token;
  }
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

function bindPwToggle(btnId, formId) {
  const btn = $(btnId), form = $(formId);
  if (!btn || !form) return;
  btn.onclick = () => {
    const p = form.elements.password;
    p.type = p.type === 'password' ? 'text' : 'password';
    btn.textContent = p.type === 'password' ? '보기' : '숨기기';
  };
}
bindPwToggle('showpw', 'credentials');
bindPwToggle('showCreatePw', 'create');
bindPwToggle('showRoomPassPw', 'roomPass');
bindPwToggle('showLockPw', 'lockForm');

function authMode(value) {
  mode = value;
  const reg = mode === 'register';
  $('login').setAttribute('aria-pressed', String(!reg));
  $('register').setAttribute('aria-pressed', String(reg));
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
  for (const k of ['auth', 'create', 'roomPass', 'profile']) $(k).hidden = k !== part;
  $('heading').textContent = {
    auth: '작가 계정',
    create: '새 집필실',
    roomPass: state?.hasPassword ? '원고 비밀번호 변경' : '원고 비밀번호 설정',
    profile: '내 계정'
  }[part];
  $('error').textContent = '';
  if (part === 'auth') authMode('login');
  if (part === 'roomPass') $('removeRoomPass').hidden = !state?.hasPassword;
  if (!$('modal').open) $('modal').showModal();
}

$('modal').onclose = () => {
  for (const [f, b] of [['credentials', 'showpw'], ['create', 'showCreatePw'], ['roomPass', 'showRoomPassPw']]) {
    const pw = $(f)?.elements?.password;
    if (pw) { pw.value = ''; pw.type = 'password'; }
    if ($(b)) $(b).textContent = '보기';
  }
  intent = '';
};
$('modal').addEventListener('click', e => {
  if (e.target === $('modal')) $('modal').close();
});
$('close').onclick = () => $('modal').close();
$('login').onclick = () => authMode('login');
$('register').onclick = () => authMode('register');

function showUser() {
  $('account').textContent = user || '로그인';
  $('who').textContent = user ? user + ' 님으로 로그인했어요.' : '';
}
$('account').onclick = () => { intent = ''; dialog(user ? 'profile' : 'auth'); };
$('new').onclick = () => { intent = 'create'; dialog(user ? 'create' : 'auth'); };
$('roomPassBtn').onclick = () => { intent = ''; dialog('roomPass'); };

function bindCounter(textarea, counterId) {
  const counter = $(counterId);
  if (!textarea || !counter) return;
  const update = () => { counter.textContent = textarea.value.length.toLocaleString() + ' / 3,000자'; };
  textarea.addEventListener('input', update);
  update();
}
bindCounter($('create')?.elements.text, 'createCount');
bindCounter($('write')?.elements.text, 'writeCount');

function draw(s) {
  if (s.locked) {
    state = s;
    lastUser = user;
    saveRoomToken(s.id, '');
    $('lockGate').hidden = false;
    $('roomHead').hidden = true;
    $('roomGrid').hidden = true;
    $('story').replaceChildren();
    document.title = '비공개 원고 · ' + brand;
    return;
  }

  $('lockGate').hidden = true;
  $('roomHead').hidden = false;
  $('roomGrid').hidden = false;
  $('lockError').textContent = '';

  if (state && !state.locked && s.rev < state.rev) return;
  const same = state && !state.locked && s.rev === state.rev && s.me === state.me && s.reclaim === state.reclaim && s.hasPassword === state.hasPassword && lastUser === user;
  const prevLen = state && !state.locked ? state.paragraphs.length : s.paragraphs.length;
  state = s;
  lastUser = user;
  if (same) return;

  $('title').textContent = s.title;
  document.title = s.title + ' · ' + brand;
  if (user && s.me >= 0) saveLocalHistory({ id: s.id, title: s.title, updatedAt: Date.now() });

  $('roomPassBtn').hidden = !user || s.me !== 0;
  $('roomPassBtn').textContent = s.hasPassword ? '비밀번호 변경' : '비밀번호 설정';

  const sections = s.paragraphs.map((p, i) => {
    const section = el('section', '');
    if (i >= prevLen) section.classList.add('is-new');
    section.append(el('small', (i + 1) + '번째 문단 · ' + p.name), el('p', p.text));
    return section;
  });
  $('story').replaceChildren(...sections);
  if (s.paragraphs.length > prevLen) {
    sections[sections.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('people').replaceChildren(...s.people.map((p, i) => {
    const current = s.started && s.turn === i;
    const isLast = s.started && s.turn === -1 && i === s.lastWriter;
    const suffix = (i === s.me ? ' (나)' : '') + (current ? ' · 집필 중' : isLast ? ' · 직전 작성' : '');
    const li = el('li', p + suffix);
    li.classList.toggle('current', current);
    li.classList.toggle('last-writer', isLast);
    return li;
  }));

  if (!s.started) {
    $('status').textContent = s.people.length + '명 참여 중 · 친구를 더 초대하거나, 2명 이상 모이면 시작할 수 있어요.';
  } else if (s.turn >= 0) {
    $('status').textContent = s.turn === s.me
      ? '지금 내 차례예요! 다음 문단을 자유롭게 써 보세요.'
      : s.people[s.turn] + ' 님이 지금 집필 중이에요. (총 ' + s.people.length + '명 참여 중)';
  } else if (s.me >= 0 && s.me === s.lastWriter) {
    $('status').textContent = '방금 문단을 작성하셨어요! 다른 작가가 이어 쓸 때까지 기다려 주세요.';
  } else if (s.me >= 0) {
    $('status').textContent = '지금 이어 쓸 수 있어요! 아래 버튼을 눌러 집필을 시작하세요.';
  } else {
    $('status').textContent = '다음 작가를 기다리는 중이에요. (총 ' + s.people.length + '명 참여 중)';
  }

  $('join').hidden = s.me >= 0;
  $('join').textContent = !user
    ? '로그인하고 참여하기'
    : s.reclaim
      ? '기존 참여 기록 연결'
      : s.started
        ? '중간에 참여하기'
        : '집필에 참여하기';
  $('start').hidden = !user || s.started || s.me !== 0 || s.people.length < 2;
  $('claim').hidden = !user || !s.started || s.me < 0 || s.turn !== -1 || s.me === s.lastWriter;
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
    if ($('modal').open) $('error').textContent = e.message;
    else {
      toast(e.message);
      if (roomId) refresh();
    }
  }
  finally {
    if (button.textContent === '처리 중…') button.textContent = original;
    button.disabled = false;
  }
}

$('lockForm').onsubmit = e => {
  e.preventDefault();
  const btn = e.submitter || $('lockForm').querySelector('button:not([type="button"])');
  $('lockError').textContent = '';
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '확인 중…';
  (async () => {
    try {
      const v = await api({ action: 'unlock', password: e.target.elements.password.value }, roomId);
      if (v.roomToken) saveRoomToken(roomId, v.roomToken);
      e.target.reset();
      draw(v);
      toast('원고 잠금을 해제했어요.');
    } catch (err) {
      $('lockError').textContent = err.message;
      e.target.elements.password.focus();
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  })();
};

$('roomPass').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const v = await api({ action: 'setPassword', password: e.target.elements.password.value }, roomId);
    if (v.roomToken) saveRoomToken(roomId, v.roomToken);
    $('modal').close();
    draw(v);
    toast('원고 비밀번호를 저장했어요.');
  });
};

$('removeRoomPass').onclick = () => {
  if (!confirm('이 원고의 비밀번호 잠금을 해제할까요? 초대 링크가 있는 누구나 볼 수 있게 됩니다.')) return;
  run($('removeRoomPass'), async () => {
    const v = await api({ action: 'setPassword', password: '' }, roomId);
    saveRoomToken(roomId, '');
    $('modal').close();
    draw(v);
    toast('원고 비밀번호 잠금을 해제했어요.');
  });
};

$('credentials').onsubmit = e => {
  e.preventDefault();
  run($('submitAuth'), async () => {
    const v = await api({ action: mode, ...Object.fromEntries(new FormData(e.target)) });
    user = v.name;
    authChecked = true;
    serverRooms = Array.isArray(v.rooms) ? v.rooms : [];
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
  clearBrowserSecrets();
  location.reload();
});

$('create').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const v = await api({ action: 'create', ...Object.fromEntries(new FormData(e.target)) });
    if (v.roomToken) saveRoomToken(v.id, v.roomToken);
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

$('start').onclick = () => run($('start'), async () => {
  draw(await api({ action: 'start' }, roomId));
  toast('이어쓰기를 시작했어요! 직전 작가를 제외한 누구나 쓸 수 있어요.');
});

$('claim').onclick = () => run($('claim'), async () => {
  draw(await api({ action: 'claim' }, roomId));
  $('write')?.elements.text?.focus();
  toast('집필을 시작했어요!');
});

$('release').onclick = () => run($('release'), async () => {
  draw(await api({ action: 'release' }, roomId));
  toast('다른 작가가 이어 쓸 수 있도록 차례를 양보했어요.');
});

$('write').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const v = await api({
      action: 'write',
      text: e.target.elements.text.value,
      rev: state.rev,
      count: state.paragraphs.length
    }, roomId);
    e.target.reset();
    if ($('writeCount')) $('writeCount').textContent = '0 / 3,000자';
    draw(v);
    toast('문단을 등록했어요! 다음 작가를 기다립니다.');
  });
};

$('invite').onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast(state?.hasPassword ? '초대 링크를 복사했어요. 비밀번호도 함께 알려 주세요.' : '초대 링크를 복사했어요.');
  } catch {
    $('link').hidden = false;
    $('link').value = location.href;
    $('link').select();
  }
};

async function deleteManuscript(item, container) {
  if (!confirm(`"${item.title}" 원고를 내 목록에서 삭제할까요?`)) return;
  container?.classList.add('removing');
  await new Promise(ok => setTimeout(ok, 220));
  removeLocalHistory(item.id);
  saveRoomToken(item.id, '');
  serverRooms = serverRooms.filter(r => r.id !== item.id);
  if (user) {
    try {
      const res = await api({ action: 'removeRoom', roomId: item.id });
      if (Array.isArray(res.rooms)) serverRooms = res.rooms;
    } catch (e) {
      toast(e.message);
    }
  }
  renderHome();
  toast('목록에서 원고를 삭제했어요.');
}

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
  const content = $('recent');
  const count = $('shelfCount');
  const historyBox = $('history');
  const historyList = $('historyList');
  const manuscriptCard = content.closest('.manuscript');

  manuscriptCard?.classList.remove('removing');
  content.replaceChildren();
  historyList.replaceChildren();
  drawLandscape();

  if (!authChecked) {
    count.hidden = true;
    historyBox.hidden = true;
    content.append(
      el('h3', '집필실을 불러오는 중…'),
      el('p', '로그인 상태를 확인하고 있어요.')
    );
    return;
  }

  if (!user) {
    count.hidden = true;
    historyBox.hidden = true;
    content.append(
      el('h3', '로그인이 필요해요.'),
      el('p', '로그인하면 내가 참여한 원고 목록을 확인하고 새 집필실을 열 수 있어요.')
    );
    const loginBtn = el('button', '로그인하기', 'shine');
    loginBtn.type = 'button';
    loginBtn.onclick = () => { intent = ''; dialog('auth'); };
    content.append(loginBtn);
    return;
  }

  const list = mergedHistory();
  if (list.length) {
    count.textContent = '총 ' + list.length + '편';
    count.hidden = false;

    const latest = list[0];
    const dateText = formatDate(latest.updatedAt);
    content.append(el('span', dateText ? '가장 최근 원고 · ' + dateText : '가장 최근 원고', 'tag'));
    content.append(el('h3', latest.title));

    const actions = el('div', '', 'recent-actions');
    const link = el('a', '원고 열기');
    link.href = '/?room=' + encodeURIComponent(latest.id);
    const delBtn = el('button', '목록에서 삭제', 'danger-btn');
    delBtn.type = 'button';
    delBtn.onclick = () => deleteManuscript(latest, manuscriptCard);
    actions.append(link, delBtn);
    content.append(actions);

    const rest = list.slice(1);
    historyBox.hidden = !rest.length;
    rest.forEach((item, idx) => {
      const li = el('li', '', 'history-item');
      li.style.setProperty('--i', idx);
      const a = el('a', '', 'history-card');
      a.href = '/?room=' + encodeURIComponent(item.id);
      const meta = el('div', '', 'history-meta');
      meta.append(el('span', item.title, 'history-name'));
      const d = formatDate(item.updatedAt);
      if (d) meta.append(el('span', '최근 활동 · ' + d, 'history-date'));
      a.append(meta, el('span', '→', 'history-arrow'));

      const del = el('button', '×', 'history-del');
      del.type = 'button';
      del.setAttribute('aria-label', item.title + ' 목록에서 삭제');
      del.title = '목록에서 삭제';
      del.onclick = () => deleteManuscript(item, li);

      li.append(a, del);
      historyList.append(li);
    });
  } else {
    count.hidden = true;
    historyBox.hidden = true;
    content.append(
      el('h3', '아직 집필 중인 원고가 없어요.'),
      el('p', '새 집필실에서 첫 문단을 쓰거나 친구가 보낸 초대 링크로 참여하세요.')
    );
  }
}

// 1. 화면 전환 및 풍경 표지는 즉시 렌더링 (원고 목록은 로그인 확인 후 표시)
$('home').hidden = !!roomId;
$('room').hidden = !roomId;
if (!roomId) renderHome();

// 2. 세션 확인 및 방 동기화는 비동기로 실행
(async () => {
  try {
    const info = await api();
    user = info.name;
    serverRooms = user && Array.isArray(info.rooms) ? info.rooms : [];
    showUser();
  } catch (e) {
    toast(e.message);
  } finally {
    authChecked = true;
    if (!roomId) renderHome();
  }
  if (roomId) {
    await refresh();
    setInterval(() => { if (!document.hidden && !state?.locked) refresh(); }, 3500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !state?.locked) refresh(); });
  }
})();
