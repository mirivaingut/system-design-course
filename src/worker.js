// Worker אחד שמגיש את האתר, מחזיק API קטן ושולח תזכורות במייל (Cron).
// כל האתר מוגן בקוד גישה (ACCESS_TOKEN, secret ב-Cloudflare): כניסה בדף /login
// יוצרת עוגיית סשן חתומה (HMAC). ה-API מקבל גם Authorization: Bearer <קוד> לסקריפטים.

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

const MAX_BODY = 512 * 1024;
const TZ = 'Asia/Jerusalem';

const DEFAULT_SETTINGS = {
  enabled: false,
  email: '',
  mode: 'interval',      // 'interval' = כל X ימים, 'weekdays' = בימים קבועים בשבוע
  everyDays: 2,
  weekdays: [0, 2, 4],   // 0 = ראשון
  hour: 19,
  inactiveDays: 2,       // כמה ימים בלי כניסה עד שנשלחת "התגעגענו"
  skipIfVisitedToday: true,
};

const SESSION_COOKIE = 'sdc_session';
const LONG_SESSION = 30 * 86400;   // "לזכור אותי"
const SHORT_SESSION = 12 * 3600;   // מחשב משותף
const TOTAL_LESSONS = 16;
const MAX_LOGIN_FAILS = 8;         // לכל IP ב-15 דקות

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true });
      if (url.pathname === '/login') return await handleLogin(request, env, url);
      if (url.pathname === '/logout') return logout();

      const authed = await authorized(request, env);
      if (url.pathname.startsWith('/api/')) {
        return authed ? await handleApi(request, env, url) : json({ error: 'unauthorized' }, 401);
      }
      if (!authed) {
        const next = url.pathname === '/' ? '' : `?next=${encodeURIComponent(url.pathname)}`;
        return new Response(null, { status: 302, headers: { location: `/login${next}`, 'cache-control': 'no-store' } });
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: 'server_error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)));
  },
};

// ---------- API ----------

async function handleApi(request, env, url) {
  const route = `${request.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/state':
      return json((await getJSON(env, 'state')) || {});

    case 'PUT /api/state': {
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_request' }, 400);
      await env.COURSE_KV.put('state', JSON.stringify(body));
      return json({ ok: true });
    }

    case 'POST /api/visit': {
      const meta = (await getJSON(env, 'meta')) || {};
      const now = new Date();
      meta.lastVisit = now.toISOString();
      meta.lastVisitDate = israelParts(now).date;
      meta.siteUrl = url.origin;
      await env.COURSE_KV.put('meta', JSON.stringify(meta));
      return json({ ok: true });
    }

    case 'GET /api/settings': {
      const settings = { ...DEFAULT_SETTINGS, ...((await getJSON(env, 'settings')) || {}) };
      const meta = (await getJSON(env, 'meta')) || {};
      return json({ settings, meta: { lastVisit: meta.lastVisit, lastSent: meta.lastSent, lastSentKind: meta.lastSentKind }, mailConfigured: !!env.RESEND_API_KEY });
    }

    case 'PUT /api/settings': {
      const body = await readBody(request);
      const settings = sanitizeSettings(body);
      if (!settings) return json({ error: 'bad_request' }, 400);
      await env.COURSE_KV.put('settings', JSON.stringify(settings));
      return json({ ok: true, settings });
    }

    case 'POST /api/test-email': {
      const settings = { ...DEFAULT_SETTINGS, ...((await getJSON(env, 'settings')) || {}) };
      if (!settings.email) return json({ error: 'no_email' }, 400);
      const meta = (await getJSON(env, 'meta')) || {};
      const state = (await getJSON(env, 'state')) || {};
      const result = await sendEmail(env, settings.email, buildEmail('test', { state, meta, days: 0 }));
      return json(result, result.ok ? 200 : 502);
    }
  }

  return json({ error: 'not_found' }, 404);
}

function sanitizeSettings(b) {
  if (!b || typeof b !== 'object') return null;
  const s = { ...DEFAULT_SETTINGS };
  s.enabled = !!b.enabled;
  s.email = typeof b.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim()) ? b.email.trim().slice(0, 200) : '';
  s.mode = b.mode === 'weekdays' ? 'weekdays' : 'interval';
  s.everyDays = clampInt(b.everyDays, 1, 14, 2);
  s.weekdays = Array.isArray(b.weekdays) ? [...new Set(b.weekdays.map(Number).filter((d) => d >= 0 && d <= 6))] : DEFAULT_SETTINGS.weekdays;
  s.hour = clampInt(b.hour, 0, 23, 19);
  s.inactiveDays = clampInt(b.inactiveDays, 0, 30, 2);
  s.skipIfVisitedToday = b.skipIfVisitedToday !== false;
  return s;
}

function clampInt(v, min, max, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

// ---------- כניסה ----------

async function authorized(request, env) {
  if (!env.ACCESS_TOKEN) return false;
  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) return codeMatches(header.slice(7), env);
  return validSession(getCookie(request, SESSION_COOKIE), env);
}

// השוואה בזמן קבוע: משווים hash של שני הערכים
async function codeMatches(code, env) {
  if (!code || !env.ACCESS_TOKEN) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(code)),
    crypto.subtle.digest('SHA-256', enc.encode(env.ACCESS_TOKEN)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// הסשן הוא "תוקף.חתימה". החתימה תלויה בקוד, ולכן החלפת קוד מנתקת את כל הדפדפנים.
function hmacKey(env, usage) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode('sdc-session:' + env.ACCESS_TOKEN),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function makeSession(env, ttl) {
  const exp = String(Math.floor(Date.now() / 1000) + ttl);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env, 'sign'), new TextEncoder().encode(exp));
  return `${exp}.${b64url(sig)}`;
}

async function validSession(value, env) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() / 1000 || !sig) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(env, 'verify'), fromB64url(sig), new TextEncoder().encode(exp));
  } catch { return false; }
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const hit = header.split(/;\s*/).find((c) => c.startsWith(name + '='));
  return hit ? hit.slice(name.length + 1) : '';
}

const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-./]*$/.test(n) ? n : '/');

async function handleLogin(request, env, url) {
  if (request.method === 'GET') {
    if (await authorized(request, env)) return redirect(safeNext(url.searchParams.get('next')));
    return loginPage({ next: safeNext(url.searchParams.get('next')) });
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const form = await request.formData();
  const next = safeNext(form.get('next'));
  const hash = /^#\/[\w\-/]*$/.test(form.get('hash') || '') ? form.get('hash') : '';
  const remember = form.get('remember') === 'on';
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const failKey = `login-fail:${ip}`;
  const fails = Number((await env.COURSE_KV.get(failKey)) || 0);

  if (fails >= MAX_LOGIN_FAILS) {
    return loginPage({ next, hash, error: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות.' }, 429);
  }
  if (!(await codeMatches(String(form.get('code') || ''), env))) {
    await env.COURSE_KV.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return loginPage({ next, hash, error: 'הקוד לא נכון. נסי שוב.' }, 401);
  }

  const ttl = remember ? LONG_SESSION : SHORT_SESSION;
  const cookie = `${SESSION_COOKIE}=${await makeSession(env, ttl)}; Path=/; HttpOnly; Secure; SameSite=Lax${remember ? `; Max-Age=${ttl}` : ''}`;
  return redirect(next + hash, cookie);
}

function logout() {
  return redirect('/login', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function redirect(location, cookie) {
  const headers = { location, 'cache-control': 'no-store' };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

function loginPage({ next, hash = '', error = '' }, status = 200) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>כניסה · מסע ל-System Design</title>
<meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@500;700&family=Assistant:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f2ea;--card:#fffdf9;--ink:#2b2540;--soft:#57506f;--line:#e7dfd3;--primary:#4b3f8f;--accent:#e0644d;--err:#c8453d;--errbg:#fbe3e1}
@media (prefers-color-scheme:dark){:root{--bg:#16131d;--card:#201c2a;--ink:#eeeaf7;--soft:#c6bfdb;--line:#362f47;--primary:#ab9ff6;--accent:#ff9a84;--err:#ff8a80;--errbg:#45221f}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font-family:Assistant,"Segoe UI",Arial,sans-serif;font-size:17px}
.card{width:min(400px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:34px 28px;box-shadow:0 10px 40px rgba(43,37,64,.12);text-align:center}
.mark{width:56px;height:56px;border-radius:16px;margin:0 auto 14px;background:linear-gradient(135deg,var(--primary),var(--accent));position:relative}
.mark::after{content:"";position:absolute;inset:16px;border-radius:50%;border:3px solid #fff}
h1{font-family:Rubik,Assistant,sans-serif;font-size:24px;margin:0 0 6px}h1 b{color:var(--primary)}
p{color:var(--soft);margin:0 0 22px}
input[type=password]{width:100%;font:inherit;font-size:18px;padding:13px 16px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink);text-align:center;letter-spacing:.08em}
input[type=password]:focus{outline:none;border-color:var(--primary)}
label{display:flex;gap:8px;align-items:center;justify-content:center;margin:14px 0 18px;color:var(--soft);font-size:15px;cursor:pointer}
input[type=checkbox]{width:18px;height:18px;accent-color:var(--primary)}
button{width:100%;font:inherit;font-weight:700;font-size:17px;padding:13px;border:0;border-radius:999px;background:var(--accent);color:#fff;cursor:pointer}
button:hover{filter:brightness(1.05)}
.err{background:var(--errbg);color:var(--err);border-radius:12px;padding:10px 12px;margin-bottom:16px;font-weight:600;font-size:15px}
small{display:block;margin-top:18px;color:var(--soft);font-size:13px}
</style></head><body>
<form class="card" method="post" action="/login">
  <div class="mark" aria-hidden="true"></div>
  <h1>מסע ל-<b>System Design</b></h1>
  <p>ברוכה הבאה! הזיני את קוד הכניסה שלך</p>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
  <input type="password" name="code" autocomplete="current-password" aria-label="קוד כניסה" required autofocus>
  <input type="hidden" name="next" value="${esc(next)}"><input type="hidden" name="hash" id="hash" value="${esc(hash)}">
  <label><input type="checkbox" name="remember" checked> לזכור אותי במחשב הזה (30 יום)</label>
  <button type="submit">כניסה ←</button>
  <small>במחשב משותף כדאי לבטל את "לזכור אותי".</small>
</form>
<script nonce="${nonce}">if (location.hash) document.getElementById('hash').value = location.hash;</script>
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

async function readBody(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function getJSON(env, key) {
  const v = await env.COURSE_KV.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// ---------- תזכורות ----------

export async function runReminders(env, now = new Date()) {
  const settings = { ...DEFAULT_SETTINGS, ...((await getJSON(env, 'settings')) || {}) };
  if (!settings.enabled || !settings.email || !env.RESEND_API_KEY) return;

  const { date, hour, weekday } = israelParts(now);
  if (hour !== settings.hour) return;

  const meta = (await getJSON(env, 'meta')) || {};
  if (meta.lastSentDate === date) return; // מקסימום מייל אחד ביום

  const daysSinceVisit = meta.lastVisitDate ? dayDiff(meta.lastVisitDate, date) : null;
  const daysSinceSent = meta.lastSentDate ? dayDiff(meta.lastSentDate, date) : Infinity;

  const scheduledToday = settings.mode === 'weekdays'
    ? settings.weekdays.includes(weekday)
    : daysSinceSent >= settings.everyDays;

  const inactive = settings.inactiveDays > 0 && daysSinceVisit !== null && daysSinceVisit >= settings.inactiveDays;
  // "התגעגענו" נשלח ביום שבו עוברים את הסף, ואחר כך מצטרף לתזכורות הקבועות
  const crossedThresholdToday = inactive && daysSinceVisit === settings.inactiveDays;

  let kind = null;
  if (inactive && (scheduledToday || crossedThresholdToday)) kind = 'nudge';
  else if (scheduledToday) {
    if (settings.skipIfVisitedToday && daysSinceVisit === 0) return;
    kind = 'reminder';
  }
  if (!kind) return;

  const state = (await getJSON(env, 'state')) || {};
  const result = await sendEmail(env, settings.email, buildEmail(kind, { state, meta, days: daysSinceVisit }));
  if (result.ok) {
    meta.lastSent = now.toISOString();
    meta.lastSentDate = date;
    meta.lastSentKind = kind;
    await env.COURSE_KV.put('meta', JSON.stringify(meta));
  }
}

function israelParts(d) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: weekdays[parts.weekday] };
}

function dayDiff(fromDate, toDate) {
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

async function sendEmail(env, to, { subject, html }) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'mail_not_configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'System Design Course <onboarding@resend.dev>', to: [to], subject, html }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error('resend failed', res.status, detail);
    return { ok: false, error: 'send_failed', status: res.status, detail };
  }
  return { ok: true };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildEmail(kind, { state, meta, days }) {
  const site = meta.siteUrl || '';
  const next = state.nextLesson;
  const done = Object.keys(state.completed || {}).length;
  const link = next && site ? `${site}/#/lesson/${next.id}` : site;

  const copy = {
    reminder: {
      subject: next ? `☕ הגיע הזמן לשיעור ${next.id}: ${next.title}` : '☕ הגיע הזמן לשיעור הבא',
      title: 'רבע שעה בשבילך',
      body: 'לפי התוכנית, היום יש שיעור. מכינים קפה, פותחים את השיעור, ותוך רבע שעה עד חצי שעה מתקדמים עוד תחנה.',
    },
    nudge: {
      subject: `👋 עברו ${days} ימים מאז הביקור האחרון`,
      title: 'התגעגענו!',
      body: `עברו <b>${days} ימים</b> מאז שנכנסת לקורס. זה לגמרי בסדר, החיים קורים. רק כדאי לחזור לפני שהחומר מתחיל להישכח: שיעור אחד קצר היום מחזיר את המומנטום.`,
    },
    test: {
      subject: '✅ מייל בדיקה מקורס System Design',
      title: 'המיילים עובדים!',
      body: 'זה מייל בדיקה. אם הוא הגיע, התזכורות מוגדרות כמו שצריך.',
    },
  }[kind];

  const html = `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f6f1ea;font-family:Arial,Helvetica,sans-serif;color:#2b2540">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e9e1d6">
    <div style="background:#4b3f8f;color:#fff;padding:22px 26px;font-size:20px;font-weight:bold">${esc(copy.title)}</div>
    <div style="padding:24px 26px;font-size:16px;line-height:1.7">
      <p style="margin-top:0">${copy.body}</p>
      ${next ? `<p style="background:#f3efff;border-radius:10px;padding:12px 14px;margin:18px 0"><b>השיעור הבא:</b> ${esc(next.id)}. ${esc(next.title)}</p>` : ''}
      <p style="color:#6d6687;font-size:14px">התקדמות: ${done} מתוך ${TOTAL_LESSONS} שיעורים</p>
      ${link ? `<p style="text-align:center;margin:26px 0 8px"><a href="${esc(link)}" style="background:#e8705a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:999px;font-weight:bold;display:inline-block">לשיעור ←</a></p>` : ''}
    </div>
    <div style="padding:12px 26px;background:#faf7f2;color:#8a83a3;font-size:12px">אפשר לשנות את זמני התזכורות בדף "הגדרות" באתר.</div>
  </div></body></html>`;

  return { subject: copy.subject, html };
}
