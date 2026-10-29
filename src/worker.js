// 家庭行事曆後端：Cloudflare Worker + D1
// - /api/*  事件的增刪改查、推播訂閱
// - 每分鐘的 cron 檢查到期事件，發推播給全家
//
// 推播不帶內容（免加密），手機收到後由 service worker 呼叫 /api/feed 取提醒內容。

const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const REMIND_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440];
const STALE_MS = 6 * 3600 * 1000; // 錯過超過 6 小時就不補發

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }
    try {
      return await handleApi(request, env, ctx, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: '伺服器錯誤' }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    await checkDueEvents(env, Date.now());
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, '資料格式錯誤');
  }
}

function requireFamily(request, env) {
  if (!env.FAMILY_KEY) throw new HttpError(500, '伺服器還沒設定 FAMILY_KEY');
  const given = request.headers.get('x-family-key') || '';
  if (!safeEqual(given, env.FAMILY_KEY)) throw new HttpError(401, '家庭密碼錯誤');
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname;
  const method = request.method;

  // service worker 收到推播後來取內容，用已登記的 endpoint 當憑證
  if (path === '/api/feed' && method === 'POST') {
    const { endpoint } = await readJson(request);
    return json({ alerts: await takeAlerts(env, endpoint) });
  }

  requireFamily(request, env);

  if (path === '/api/config' && method === 'GET') {
    return json({ vapidPublicKey: env.VAPID_PUBLIC_KEY || '' });
  }

  if (path === '/api/events' && method === 'GET') {
    const since = Date.now() - 400 * 86400 * 1000;
    const { results } = await env.DB.prepare(
      'SELECT id, title, note, start_at, remind_before, repeat, created_by, created_at FROM events WHERE start_at >= ? ORDER BY start_at'
    ).bind(since).all();
    return json({ events: results });
  }

  if (path === '/api/events' && method === 'POST') {
    const ev = validateEvent(await readJson(request));
    const id = crypto.randomUUID();
    const now = Date.now();
    const flags = initialFlags(ev, now);
    await env.DB.prepare(
      `INSERT INTO events (id, title, note, start_at, remind_before, repeat, created_by, created_at, notified, early_notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, ev.title, ev.note, ev.start_at, ev.remind_before, ev.repeat, ev.created_by, now, flags.notified, flags.early_notified).run();
    return json({ id }, 201);
  }

  const m = path.match(/^\/api\/events\/([\w-]+)$/);
  if (m && method === 'PUT') {
    const ev = validateEvent(await readJson(request));
    const flags = initialFlags(ev, Date.now());
    const res = await env.DB.prepare(
      `UPDATE events SET title=?, note=?, start_at=?, remind_before=?, repeat=?, notified=?, early_notified=? WHERE id=?`
    ).bind(ev.title, ev.note, ev.start_at, ev.remind_before, ev.repeat, flags.notified, flags.early_notified, m[1]).run();
    if (!res.meta.changes) throw new HttpError(404, '找不到這個事件');
    return json({ ok: true });
  }
  if (m && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM events WHERE id=?').bind(m[1]).run();
    return json({ ok: true });
  }

  if (path === '/api/subscribe' && method === 'POST') {
    const { endpoint, name } = await readJson(request);
    checkEndpoint(endpoint);
    await env.DB.prepare(
      `INSERT INTO subscriptions (endpoint, name, last_alert_id, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(id), 0) FROM alerts), ?)
       ON CONFLICT(endpoint) DO UPDATE SET name=excluded.name`
    ).bind(endpoint, String(name || '').slice(0, 30), Date.now()).run();
    return json({ ok: true });
  }

  if (path === '/api/unsubscribe' && method === 'POST') {
    const { endpoint } = await readJson(request);
    await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint=?').bind(String(endpoint || '')).run();
    return json({ ok: true });
  }

  // 只發給自己這台的測試通知
  if (path === '/api/test-push' && method === 'POST') {
    const { endpoint } = await readJson(request);
    checkEndpoint(endpoint);
    const sub = await env.DB.prepare('SELECT endpoint FROM subscriptions WHERE endpoint=?').bind(endpoint).first();
    if (!sub) throw new HttpError(400, '這台手機還沒開啟通知');
    await env.DB.prepare('INSERT INTO alerts (event_id, title, body, target, fired_at) VALUES (NULL, ?, ?, ?, ?)')
      .bind('測試通知', '通知正常，到時間會像這樣跳出來', endpoint, Date.now()).run();
    const status = await sendPush(env, endpoint);
    return json({ ok: status >= 200 && status < 300, status });
  }

  if (path === '/api/devices' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT name, created_at FROM subscriptions ORDER BY created_at').all();
    return json({ devices: results });
  }

  throw new HttpError(404, '找不到這個 API');
}

function checkEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 1000) {
    throw new HttpError(400, '推播訂閱資料錯誤');
  }
}

function validateEvent(body) {
  const title = String(body.title || '').trim().slice(0, 100);
  if (!title) throw new HttpError(400, '請輸入事情內容');
  const start_at = Number(body.start_at);
  if (!Number.isFinite(start_at) || start_at <= 0) throw new HttpError(400, '日期時間錯誤');
  const remind_before = Number(body.remind_before || 0);
  if (!REMIND_OPTIONS.includes(remind_before)) throw new HttpError(400, '提前提醒選項錯誤');
  const repeat = REPEATS.includes(body.repeat) ? body.repeat : 'none';
  return {
    title,
    note: String(body.note || '').trim().slice(0, 1000),
    start_at: Math.round(start_at),
    remind_before,
    repeat,
    created_by: String(body.created_by || '').trim().slice(0, 30),
  };
}

// 新增或修改時，已經過去的提醒直接標成已發，不要一存檔就亂跳
function initialFlags(ev, now) {
  return {
    notified: ev.start_at <= now ? 1 : 0,
    early_notified: ev.remind_before === 0 || ev.start_at - ev.remind_before * 60000 <= now ? 1 : 0,
  };
}

// ---------- 定時檢查 ----------

async function checkDueEvents(env, now) {
  const soon = now + 30000;
  const { results } = await env.DB.prepare(
    `SELECT * FROM events
     WHERE (notified = 0 AND start_at <= ?1)
        OR (notified = 0 AND early_notified = 0 AND remind_before > 0 AND start_at - remind_before * 60000 <= ?1)`
  ).bind(soon).all();

  let fired = 0;
  for (const ev of results) {
    const stale = ev.start_at < now - STALE_MS;
    const atTime = ev.start_at <= soon;

    if (!stale) {
      const when = formatWhen(ev.start_at, env);
      const title = atTime ? `⏰ ${ev.title}` : `🔔 ${ev.title}（${formatLeft(ev.start_at - now)}後）`;
      const body = [atTime ? `現在 ${when}` : `時間 ${when}`, ev.note, ev.created_by && `由 ${ev.created_by} 新增`]
        .filter(Boolean).join('\n');
      await env.DB.prepare('INSERT INTO alerts (event_id, title, body, target, fired_at) VALUES (?, ?, ?, NULL, ?)')
        .bind(ev.id, title, body, now).run();
      fired++;
    }

    if (!atTime) {
      await env.DB.prepare('UPDATE events SET early_notified = 1 WHERE id = ?').bind(ev.id).run();
    } else if (ev.repeat !== 'none') {
      // 重複事件：跳到下一次，重設提醒
      const next = nextOccurrence(ev.start_at, ev.repeat, now, env);
      const early = ev.remind_before === 0 || next - ev.remind_before * 60000 <= now ? 1 : 0;
      await env.DB.prepare('UPDATE events SET start_at = ?, notified = 0, early_notified = ? WHERE id = ?')
        .bind(next, early, ev.id).run();
    } else {
      await env.DB.prepare('UPDATE events SET notified = 1, early_notified = 1 WHERE id = ?').bind(ev.id).run();
    }
  }

  if (fired) await pushToAll(env);
  await env.DB.prepare('DELETE FROM alerts WHERE fired_at < ?').bind(now - 2 * 86400 * 1000).run();
  return fired;
}

function tzOffsetMs(env) {
  return Number(env.TZ_OFFSET_MIN ?? 480) * 60000;
}

function nextOccurrence(startAt, repeat, now, env) {
  const off = tzOffsetMs(env);
  const base = new Date(startAt + off); // 用「當地時間」做日期運算
  const day = base.getUTCDate();
  let n = 0;
  let next = startAt;
  while (next <= now + 30000 && n < 5000) {
    n++;
    const d = new Date(base.getTime());
    if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + n);
    else if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n);
    else if (repeat === 'monthly') {
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
      d.setUTCDate(Math.min(day, daysInMonth(d)));
    } else if (repeat === 'yearly') {
      d.setUTCDate(1);
      d.setUTCFullYear(d.getUTCFullYear() + n);
      d.setUTCDate(Math.min(day, daysInMonth(d)));
    }
    next = d.getTime() - off;
  }
  return next;
}

function daysInMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function formatWhen(ms, env) {
  const d = new Date(ms + tzOffsetMs(env));
  const wk = '日一二三四五六'[d.getUTCDay()];
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${wk}）${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function formatLeft(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} 分鐘`;
  if (min < 1440) return `${Math.round(min / 60)} 小時`;
  return `${Math.round(min / 1440)} 天`;
}

// ---------- 推播 ----------

async function takeAlerts(env, endpoint) {
  if (typeof endpoint !== 'string') return [];
  const sub = await env.DB.prepare('SELECT last_alert_id FROM subscriptions WHERE endpoint = ?').bind(endpoint).first();
  if (!sub) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, event_id, title, body FROM alerts
     WHERE id > ? AND fired_at > ? AND (target IS NULL OR target = ?) ORDER BY id LIMIT 20`
  ).bind(sub.last_alert_id, Date.now() - 3 * 3600 * 1000, endpoint).all();
  if (results.length) {
    await env.DB.prepare('UPDATE subscriptions SET last_alert_id = ? WHERE endpoint = ?')
      .bind(results[results.length - 1].id, endpoint).run();
  }
  return results;
}

async function pushToAll(env) {
  const { results } = await env.DB.prepare('SELECT endpoint FROM subscriptions').all();
  await Promise.all(results.map((s) => sendPush(env, s.endpoint)));
}

async function sendPush(env, endpoint) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidHeader(env, endpoint),
        ttl: '3600',
        urgency: 'high',
      },
      body: '',
    });
    if (res.status === 404 || res.status === 410) {
      // 手機把 App 移除或關掉通知了
      console.log('push subscription gone', res.status);
      await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(endpoint).run();
    } else if (!res.ok) {
      console.warn('push failed', res.status, await res.text());
    }
    return res.status;
  } catch (err) {
    console.warn('push error', err);
    return 0;
  }
}

let signingKey;

async function vapidHeader(env, endpoint) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) throw new Error('VAPID keys not configured');
  signingKey ??= await crypto.subtle.importKey(
    'jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  }));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64url(new Uint8Array(sig))}, k=${env.VAPID_PUBLIC_KEY}`;
}

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
