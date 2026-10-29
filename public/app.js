// 家庭行事曆前端
const $ = (sel) => document.querySelector(sel);
const WEEK = '日一二三四五六';
const REPEAT_LABEL = { daily: '每天', weekly: '每週', monthly: '每月', yearly: '每年' };
const REMIND_LABEL = { 5: '提前 5 分', 10: '提前 10 分', 15: '提前 15 分', 30: '提前 30 分', 60: '提前 1 小時', 120: '提前 2 小時', 1440: '提前 1 天' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const state = {
  name: store.get('fc.name') || '',
  key: store.get('fc.key') || '',
  events: JSON.parse(store.get('fc.events') || '[]'),
  view: firstOfMonth(new Date()),
  selected: dayKey(new Date()),
  editing: null,
};

// ---------- 小工具 ----------

function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function hm(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }

// 重複事件展開成多次（跟後端算法一致：每月 31 號遇到小月改成月底）
function occurrences(ev, from, to) {
  const out = [];
  const base = new Date(ev.start_at);
  if (ev.repeat === 'none' || !REPEAT_LABEL[ev.repeat]) {
    if (ev.start_at >= from && ev.start_at < to) out.push(ev.start_at);
    return out;
  }
  const day = base.getDate();
  for (let n = 0; n < 800; n++) {
    let d;
    if (ev.repeat === 'daily') d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, base.getHours(), base.getMinutes());
    else if (ev.repeat === 'weekly') d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7 * n, base.getHours(), base.getMinutes());
    else {
      const y = base.getFullYear() + (ev.repeat === 'yearly' ? n : 0);
      const m = base.getMonth() + (ev.repeat === 'monthly' ? n : 0);
      const first = new Date(y, m, 1);
      d = new Date(first.getFullYear(), first.getMonth(), Math.min(day, daysInMonth(first.getFullYear(), first.getMonth())), base.getHours(), base.getMinutes());
    }
    const t = d.getTime();
    if (t >= to) break;
    if (t >= from) out.push(t);
  }
  return out;
}

function occurrencesBetween(from, to) {
  const list = [];
  for (const ev of state.events) for (const t of occurrences(ev, from, to)) list.push({ ev, t });
  return list.sort((a, b) => a.t - b.t);
}

// ---------- 伺服器 ----------

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-family-key': state.key, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout();
    throw new Error(data.error || '家庭密碼錯誤');
  }
  if (!res.ok) throw new Error(data.error || `伺服器錯誤（${res.status}）`);
  return data;
}

async function refresh() {
  try {
    const { events } = await api('/api/events');
    state.events = events;
    store.set('fc.events', JSON.stringify(events));
    setStatus(`已同步 ${hm(new Date())}`);
  } catch (err) {
    setStatus(navigator.onLine ? `同步失敗：${err.message}` : '目前離線，顯示上次的資料');
  }
  render();
}

function setStatus(text) { $('#status').textContent = text; }

// ---------- 畫面 ----------

function render() {
  renderGrid();
  renderDay();
  renderUpcoming();
}

function renderGrid() {
  const v = state.view;
  $('#month-title').textContent = `${v.getFullYear()} 年 ${v.getMonth() + 1} 月`;
  const start = new Date(v.getFullYear(), v.getMonth(), 1 - v.getDay());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
  const byDay = new Map();
  for (const o of occurrencesBetween(start.getTime(), end.getTime())) {
    const k = dayKey(new Date(o.t));
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const today = dayKey(new Date());
  const grid = $('#grid');
  grid.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = dayKey(d);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    if (d.getMonth() !== v.getMonth()) cell.classList.add('other');
    if (k === today) cell.classList.add('today');
    if (k === state.selected) cell.classList.add('selected');
    const count = byDay.get(k) || 0;
    cell.setAttribute('aria-label', `${d.getMonth() + 1} 月 ${d.getDate()} 日${count ? `，${count} 件事` : ''}`);
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = d.getDate();
    const dots = document.createElement('span');
    dots.className = 'dots';
    for (let j = 0; j < Math.min(count, 3); j++) dots.append(Object.assign(document.createElement('span'), { className: 'dot' }));
    if (count > 3) dots.append(Object.assign(document.createElement('span'), { className: 'more', textContent: '+' }));
    cell.append(num, dots);
    cell.addEventListener('click', () => {
      state.selected = k;
      if (d.getMonth() !== v.getMonth()) state.view = firstOfMonth(d);
      render();
    });
    grid.append(cell);
  }
}

function renderDay() {
  const d = parseKey(state.selected);
  const isToday = state.selected === dayKey(new Date());
  $('#day-title').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日（${WEEK[d.getDay()]}）${isToday ? '・今天' : ''}`;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  fillList($('#day-list'), occurrencesBetween(d.getTime(), next.getTime()), '這天沒有安排，按右下角 ＋ 新增', false);
}

function renderUpcoming() {
  const now = Date.now();
  const list = occurrencesBetween(now, now + 60 * 86400 * 1000).slice(0, 8);
  fillList($('#upcoming-list'), list, '接下來 60 天沒有事情', true);
}

function fillList(ul, items, emptyText, showDate) {
  ul.replaceChildren();
  if (!items.length) {
    ul.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: emptyText }));
    return;
  }
  const now = Date.now();
  for (const { ev, t } of items) {
    const d = new Date(t);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event' + (t < now ? ' past' : '');
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = hm(d);
    if (showDate) time.append(Object.assign(document.createElement('small'), { textContent: `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）` }));
    const body = document.createElement('span');
    const title = Object.assign(document.createElement('div'), { className: 'title', textContent: ev.title });
    const tags = [REPEAT_LABEL[ev.repeat], REMIND_LABEL[ev.remind_before], ev.created_by && `${ev.created_by} 新增`].filter(Boolean).join('・');
    const sub = Object.assign(document.createElement('div'), { className: 'sub', textContent: [tags, ev.note].filter(Boolean).join('\n') });
    body.append(title, sub);
    btn.append(time, body);
    btn.addEventListener('click', () => openEditor(ev));
    li.append(btn);
    ul.append(li);
  }
}

// ---------- 新增 / 編輯 ----------

function openEditor(ev) {
  state.editing = ev || null;
  const f = $('#event-form');
  f.reset();
  $('#event-error').textContent = '';
  $('#dialog-title').textContent = ev ? '修改事件' : '新增事件';
  $('#delete-event').hidden = !ev;
  if (ev) {
    const d = new Date(ev.start_at);
    f.title.value = ev.title;
    f.date.value = dayKey(d);
    f.time.value = hm(d);
    f.remind_before.value = String(ev.remind_before);
    f.repeat.value = ev.repeat;
    f.note.value = ev.note;
    $('#event-meta').textContent = [
      ev.created_by && `${ev.created_by} 新增`,
      ev.repeat !== 'none' && '重複事件：修改會套用到之後每一次',
    ].filter(Boolean).join('・');
  } else {
    f.date.value = state.selected;
    const now = new Date();
    f.time.value = state.selected === dayKey(now) ? `${pad((now.getHours() + 1) % 24)}:00` : '09:00';
    $('#event-meta').textContent = '';
  }
  $('#event-dialog').showModal();
  if (!ev) f.title.focus();
}

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const start = new Date(`${f.date.value}T${f.time.value}`);
  if (Number.isNaN(start.getTime())) {
    $('#event-error').textContent = '日期時間不正確';
    return;
  }
  const payload = {
    title: f.title.value,
    note: f.note.value,
    start_at: start.getTime(),
    remind_before: Number(f.remind_before.value),
    repeat: f.repeat.value,
    created_by: state.editing ? state.editing.created_by : state.name,
  };
  const save = $('#save-event');
  save.disabled = true;
  save.textContent = '儲存中…';
  try {
    if (state.editing) await api(`/api/events/${state.editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
    $('#event-dialog').close();
    state.selected = dayKey(start);
    state.view = firstOfMonth(start);
    await refresh();
  } catch (err) {
    $('#event-error').textContent = `沒存成功：${err.message}`;
  } finally {
    save.disabled = false;
    save.textContent = '儲存';
  }
});

$('#cancel-event').addEventListener('click', () => $('#event-dialog').close());

$('#delete-event').addEventListener('click', async () => {
  const ev = state.editing;
  if (!ev) return;
  const msg = ev.repeat !== 'none' ? `刪除「${ev.title}」？之後每一次都會一起刪掉。` : `刪除「${ev.title}」？`;
  if (!confirm(msg)) return;
  const btn = $('#delete-event');
  btn.disabled = true;
  try {
    await api(`/api/events/${ev.id}`, { method: 'DELETE' });
    $('#event-dialog').close();
    await refresh();
  } catch (err) {
    $('#event-error').textContent = `刪除失敗：${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- 通知 ----------

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let swReady = null;

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported || !swReady) return null;
  const reg = await swReady;
  return reg.pushManager.getSubscription();
}

async function subscribe() {
  const reg = await swReady;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { vapidPublicKey } = await api('/api/config');
    if (!vapidPublicKey) throw new Error('伺服器還沒設定推播金鑰');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) });
  }
  await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, name: state.name }) });
  return sub;
}

async function updateNotifyBanner() {
  const banner = $('#notify-banner');
  const text = $('#notify-text');
  const btn = $('#enable-notify');
  if (!pushSupported) {
    banner.hidden = false;
    btn.hidden = true;
    text.textContent = '這個瀏覽器收不到通知，請用 Chrome 開啟並「加到主畫面」';
    return;
  }
  if (Notification.permission === 'denied') {
    banner.hidden = false;
    btn.hidden = true;
    text.textContent = '通知被封鎖了：到 Chrome 的網站設定把「通知」改成允許';
    return;
  }
  const sub = Notification.permission === 'granted' ? await currentSubscription() : null;
  banner.hidden = !!sub;
  btn.hidden = false;
  text.textContent = '開啟通知，時間到才會跳提醒';
}

$('#enable-notify').addEventListener('click', async () => {
  const btn = $('#enable-notify');
  btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await subscribe();
      setStatus('通知已開啟');
    }
  } catch (err) {
    setStatus(`開啟通知失敗：${err.message}`);
  } finally {
    btn.disabled = false;
    updateNotifyBanner();
  }
});

// ---------- 設定 ----------

async function openSettings() {
  const f = $('#settings-form');
  f.name.value = state.name;
  $('#settings-msg').textContent = '';
  const sub = await currentSubscription();
  $('#notify-state').textContent = !pushSupported ? '不支援' : sub ? '已開啟' : Notification.permission === 'denied' ? '被封鎖' : '未開啟';
  $('#test-notify').disabled = !sub;
  if (!sub) $('#settings-msg').textContent = '通知還沒開啟：先關掉設定，按畫面上方的「開啟通知」。';
  const list = $('#device-list');
  list.replaceChildren(Object.assign(document.createElement('li'), { textContent: '讀取中…' }));
  $('#settings-dialog').showModal();
  try {
    const { devices } = await api('/api/devices');
    list.replaceChildren(...(devices.length
      ? devices.map((d) => Object.assign(document.createElement('li'), { textContent: d.name || '（沒名字）' }))
      : [Object.assign(document.createElement('li'), { textContent: '還沒有' })]));
  } catch (err) {
    list.replaceChildren(Object.assign(document.createElement('li'), { textContent: `讀取失敗：${err.message}` }));
  }
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (name && name !== state.name) {
    state.name = name;
    store.set('fc.name', name);
    if (await currentSubscription()) subscribe().catch(() => {});
  }
  $('#settings-dialog').close();
});

$('#test-notify').addEventListener('click', async () => {
  const btn = $('#test-notify');
  btn.disabled = true;
  $('#settings-msg').textContent = '送出中…';
  try {
    const sub = await currentSubscription();
    const r = await api('/api/test-push', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    $('#settings-msg').textContent = r.ok ? '已送出，幾秒內應該會跳通知' : `推播服務回應 ${r.status}，沒送成功`;
  } catch (err) {
    $('#settings-msg').textContent = `失敗：${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  if (!confirm('登出後這台手機不會再收到通知，確定？')) return;
  try {
    const sub = await currentSubscription();
    if (sub) {
      await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } finally {
    $('#settings-dialog').close();
    logout();
  }
});

// ---------- 啟動 ----------

function logout() {
  state.key = '';
  store.del('fc.key');
  store.del('fc.events');
  state.events = [];
  showSetup();
}

function showSetup() {
  $('#app').hidden = true;
  $('#setup').hidden = false;
  const f = $('#setup-form');
  f.name.value = state.name;
}

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  state.name = f.name.value.trim();
  state.key = f.key.value;
  btn.disabled = true;
  $('#setup-error').textContent = '';
  try {
    await api('/api/config');
    store.set('fc.name', state.name);
    store.set('fc.key', state.key);
    startApp();
  } catch (err) {
    state.key = '';
    $('#setup-error').textContent = err.message;
    $('#setup').hidden = false;
    $('#app').hidden = true;
  } finally {
    btn.disabled = false;
  }
});

$('#prev').addEventListener('click', () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() - 1, 1); renderGrid(); });
$('#next').addEventListener('click', () => { state.view = new Date(state.view.getFullYear(), state.view.getMonth() + 1, 1); renderGrid(); });
$('#today').addEventListener('click', () => { state.view = firstOfMonth(new Date()); state.selected = dayKey(new Date()); render(); });
$('#add').addEventListener('click', () => openEditor(null));
$('#open-settings').addEventListener('click', openSettings);

let timer = null;
function startApp() {
  $('#setup').hidden = true;
  $('#app').hidden = false;
  render();
  refresh();
  updateNotifyBanner();
  // 已允許通知的話，順手跟伺服器重新登記一次（伺服器可能清掉過）
  if (pushSupported && Notification.permission === 'granted') subscribe().then(updateNotifyBanner).catch(() => {});
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.key) { refresh(); updateNotifyBanner(); }
});

if ('serviceWorker' in navigator) swReady = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);

if (state.key) startApp();
else showSetup();
