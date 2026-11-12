// סימולציות אינטראקטיביות. כל שיעור משבץ <div class="widget" data-widget="name"></div>
(() => {
  'use strict';

  const fmt = (n, d = 0) => {
    if (!Number.isFinite(n)) return '∞';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString('en-US', { maximumFractionDigits: d });
  };
  const bytes = (b) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    let i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
  };
  const dur = (ms) => {
    if (ms < 1) return (ms * 1000).toFixed(0) + ' µs';
    if (ms < 1000) return ms.toFixed(ms < 10 ? 1 : 0) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    if (ms < 3600000) return (ms / 60000).toFixed(1) + ' min';
    if (ms < 86400000) return (ms / 3600000).toFixed(1) + ' h';
    return (ms / 86400000).toFixed(1) + ' days';
  };

  // יוצר סליידר. log=true מאפשר טווח של סדרי גודל
  function slider(id, label, { min, max, value, step = 1, log = false, show = (v) => fmt(v) }) {
    const toPos = (v) => (log ? Math.log10(v) : v);
    const fromPos = (p) => (log ? Math.round(10 ** p) : Number(p));
    return {
      html: `<div class="w-control"><label for="${id}">${label}<output id="${id}-o">${show(value)}</output></label>
        <input type="range" id="${id}" min="${toPos(min)}" max="${toPos(max)}" step="${log ? 0.01 : step}" value="${toPos(value)}"></div>`,
      read: (root) => fromPos(root.querySelector('#' + id).value),
      bind: (root, fn) => {
        const input = root.querySelector('#' + id);
        input.addEventListener('input', () => { root.querySelector('#' + id + '-o').textContent = show(fromPos(input.value)); fn(); });
      },
    };
  }

  let seq = 0;
  const nid = (p) => `${p}${++seq}`;
  const alive = (el) => document.body.contains(el);
  const metric = (label, value, cls = '') => `<div class="m ${cls}"><b>${value}</b><span>${label}</span></div>`;

  const W = {};

  // ---------- שיעור 1: הערכה גסה ----------
  W.estimate = (el) => {
    const s = {
      dau: slider(nid('dau'), 'משתמשים פעילים ביום (DAU)', { min: 1000, max: 1e9, value: 1e6, log: true }),
      msgs: slider(nid('msg'), 'הודעות למשתמש ביום', { min: 1, max: 200, value: 40 }),
      size: slider(nid('sz'), 'גודל ממוצע להודעה (bytes)', { min: 50, max: 2000, value: 200, step: 10 }),
      years: slider(nid('yr'), 'כמה שנים שומרים היסטוריה', { min: 1, max: 10, value: 5 }),
      peak: slider(nid('pk'), 'פי כמה השיא גבוה מהממוצע', { min: 1, max: 10, value: 3, show: (v) => '×' + v }),
    };
    el.innerHTML = `<div class="w-title">מחשבון Back-of-the-envelope לשיחון</div>
      <div class="w-desc">מזיזים את ההנחות ורואים איך סדרי הגודל משתנים. המטרה היא לא דיוק, אלא לדעת אם מדובר בשרת אחד או במאה.</div>
      <div class="w-controls">${Object.values(s).map((x) => x.html).join('')}</div><div class="w-out"></div><div class="w-note"></div>`;
    const out = el.querySelector('.w-out');
    const note = el.querySelector('.w-note');
    const calc = () => {
      const v = Object.fromEntries(Object.entries(s).map(([k, x]) => [k, x.read(el)]));
      const perDay = v.dau * v.msgs;
      const avg = perDay / 86400;
      const peak = avg * v.peak;
      const dayBytes = perDay * v.size;
      const total = dayBytes * 365 * v.years * 3;
      out.innerHTML = metric('הודעות ביום', fmt(perDay)) + metric('כתיבות לשנייה (ממוצע)', fmt(avg)) +
        metric('כתיבות לשנייה (שיא)', fmt(peak), peak > 50000 ? 'bad' : peak > 5000 ? 'mid' : 'ok') +
        metric('נפח ביום', bytes(dayBytes)) + metric(`נפח ל-${v.years} שנים ×3 עותקים`, bytes(total), total > 1e15 ? 'bad' : total > 1e13 ? 'mid' : 'ok');
      note.innerHTML = peak < 1000 ? '🙂 בסדר גודל כזה, שרת אחד ובסיס נתונים אחד כנראה יספיקו.'
        : peak < 20000 ? '🤔 כאן כבר צריך כמה שרתים, Load Balancer, ובסיס נתונים מכוונן היטב.'
          : '🔥 בסדר גודל כזה צריך לפצל נתונים בין מכונות רבות (Sharding), ולחשוב ברצינות על כל רכיב.';
    };
    Object.values(s).forEach((x) => x.bind(el, calc));
    calc();
  };

  // ---------- שיעור 2: מספרי Latency ----------
  W.latency = (el) => {
    const ops = [
      ['L1 cache', 'קריאה מזיכרון המטמון של המעבד', 1],
      ['RAM', 'קריאה מהזיכרון הראשי', 100],
      ['SSD read', 'קריאה אקראית מ-SSD', 100e3],
      ['Same datacenter', 'הלוך-חזור ברשת בתוך אותו Data Center', 500e3],
      ['DB query (index)', 'שאילתה פשוטה עם אינדקס', 2e6],
      ['HDD seek', 'קריאה מדיסק מכני', 10e6],
      ['Tel Aviv ↔ US', 'הלוך-חזור תל אביב-ארה"ב', 140e6],
    ];
    el.innerHTML = `<div class="w-title">מספרים שכל מהנדסת צריכה להכיר</div>
      <div class="w-desc">הזמנים האמיתיים קטנים מכדי להרגיש אותם. בתצוגה "אנושית" מתייחסים לננו-שנייה אחת כאילו הייתה שנייה, ופתאום רואים את ההבדלים.</div>
      <div class="seg" style="margin-bottom:14px"><button data-m="real" class="on">זמן אמיתי</button><button data-m="human">בקנה מידה אנושי</button></div>
      <div class="bars"></div><div class="w-note"></div>`;
    const bars = el.querySelector('.bars');
    const human = (ns) => {
      const s = ns;
      if (s < 60) return s + ' שניות';
      if (s < 3600) return (s / 60).toFixed(0) + ' דקות';
      if (s < 86400) return (s / 3600).toFixed(1) + ' שעות';
      if (s < 86400 * 60) return (s / 86400).toFixed(1) + ' ימים';
      if (s < 86400 * 365 * 2) return (s / 86400 / 30).toFixed(1) + ' חודשים';
      return (s / 86400 / 365).toFixed(1) + ' שנים';
    };
    const draw = (mode) => {
      const max = Math.log10(ops[ops.length - 1][2]) + 0.3;
      bars.innerHTML = ops.map(([n, he, ns]) => `<div class="bar-row"><span class="lbl" title="${he}">${n}</span>
        <span class="track"><span class="fill" style="display:block;width:${Math.max(3, ((Math.log10(ns) + 0.3) / max) * 100)}%"></span></span>
        <span class="val">${mode === 'real' ? dur(ns / 1e6) : human(ns)}</span></div>`).join('');
      el.querySelector('.w-note').innerHTML = mode === 'real'
        ? 'שימי לב: הסרגלים בסקאלה לוגריתמית. כל קפיצה היא פי 10 עד פי 1000.'
        : 'אם קריאה מ-RAM היא "דקה וחצי", אז שאילתה ל-DB לוקחת <b>כ-23 ימים</b>, וקריאה לשרת בחו"ל לוקחת <b>יותר מ-4 שנים</b>. בגלל זה Cache ומיקום השרתים כל כך חשובים.';
    };
    el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      el.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      draw(b.dataset.m);
    });
    draw('real');
  };

  // ---------- שיעור 3: Scaling ו-Load Balancer ----------
  W.scaling = (el) => {
    const users = slider(nid('u'), 'משתמשים מחוברים', { min: 100, max: 2e6, value: 20000, log: true });
    const servers = slider(nid('s'), 'מספר שרתים מאחורי ה-Load Balancer', { min: 1, max: 40, value: 2 });
    let down = 0;
    el.innerHTML = `<div class="w-title">כמה שרתים צריך?</div>
      <div class="w-desc">כל משתמש שולח בקשה בממוצע כל 20 שניות. כל שרת מטפל בעד 1,000 בקשות בשנייה. ככל ששרת מתקרב לקיבולת המלאה, זמן התגובה שלו מזנק (כמו תור בסופר).</div>
      <div class="w-controls">${users.html}${servers.html}</div>
      <div class="row" style="margin-bottom:8px"><button class="btn ghost small" data-k="kill">💥 להפיל שרת</button><button class="btn ghost small" data-k="heal">🔧 לתקן הכל</button></div>
      <div class="servers"></div><div class="w-out"></div><div class="w-note"></div>`;
    const calc = () => {
      const n = servers.read(el);
      down = Math.min(down, n);
      const upCount = n - down;
      const rps = users.read(el) / 20;
      const util = upCount ? rps / (upCount * 1000) : Infinity;
      const latency = util >= 1 ? Infinity : 40 / (1 - util);
      el.querySelector('.servers').innerHTML = Array.from({ length: n }, (_, i) => {
        const isDown = i >= upCount;
        const h = isDown ? 0 : Math.min(100, util * 100);
        const color = util >= 1 ? 'var(--red)' : util > 0.75 ? 'var(--amber)' : 'var(--green)';
        return `<div class="server" style="${isDown ? 'border-color:var(--red);opacity:.5' : ''}"><div class="load"><i style="height:${h}%;background:${color}"></i></div>${isDown ? '💀' : 'S' + (i + 1)}</div>`;
      }).join('');
      el.querySelector('.w-out').innerHTML = metric('בקשות לשנייה', fmt(rps)) +
        metric('עומס על כל שרת', util === Infinity ? '—' : Math.round(util * 100) + '%', util >= 1 ? 'bad' : util > 0.75 ? 'mid' : 'ok') +
        metric('זמן תגובה ממוצע', latency === Infinity ? 'קריסה' : dur(latency), latency === Infinity ? 'bad' : latency > 150 ? 'mid' : 'ok');
      el.querySelector('.w-note').innerHTML = !upCount ? '💀 כל השרתים למטה. זו המשמעות של <b>Single Point of Failure</b>: שרת אחד שנופל מפיל את כל השירות.'
        : util >= 1 ? '🔥 יותר בקשות ממה שהשרתים יכולים לעבד. התור גדל בלי סוף והמשתמשים מקבלים timeouts. צריך להוסיף שרתים.'
          : util > 0.75 ? '⚠️ השרתים בעומס של מעל 75%. זמן התגובה כבר מזנק, ואם שרת אחד ייפול, השאר לא יעמדו בעומס. לכן משאירים מרווח (headroom).'
            : n === 1 ? '🙂 העומס בסדר, אבל יש רק שרת אחד. נסי להפיל אותו.'
              : '✅ יש מספיק קיבולת וגם מרווח. נסי להפיל שרת ולראות איך העומס מתחלק בין השאר.';
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      if (b.dataset.k === 'kill') down++; else down = 0;
      calc();
    });
    users.bind(el, calc); servers.bind(el, calc); calc();
  };

  // ---------- שיעור 4: אינדקס ----------
  W.index = (el) => {
    const rows = slider(nid('r'), 'מספר שורות בטבלת messages', { min: 1000, max: 5e9, value: 1e6, log: true });
    el.innerHTML = `<div class="w-title">למה אינדקס משנה הכל</div>
      <div class="w-desc">שאילתה: <code>SELECT * FROM messages WHERE chat_id = 42</code>. בלי אינדקס, בסיס הנתונים עובר שורה-שורה (Full Table Scan). עם אינדקס (B-Tree) הוא מגיע ישר למקום.</div>
      <div class="w-controls">${rows.html}</div><div class="w-out"></div><div class="w-note"></div>`;
    const calc = () => {
      const n = rows.read(el);
      const scanMs = (n / 5e6) * 1000;
      const levels = Math.max(1, Math.ceil(Math.log(n) / Math.log(200)));
      el.querySelector('.w-out').innerHTML = metric('שורות שנבדקות בלי אינדקס', fmt(n)) +
        metric('זמן משוער בלי אינדקס', dur(scanMs), scanMs > 1000 ? 'bad' : scanMs > 100 ? 'mid' : 'ok') +
        metric('קריאות דף עם אינדקס', levels + 1, 'ok') + metric('זמן משוער עם אינדקס', '~' + (levels + 1) + ' ms', 'ok');
      el.querySelector('.w-note').innerHTML = `עץ B-Tree עם כ-200 מפתחות בכל צומת צריך רק <b>${levels}</b> רמות כדי לכסות ${fmt(n)} שורות. מיליארד שורות הן 4 רמות בלבד. המחיר: כל כתיבה צריכה לעדכן גם את האינדקס, והאינדקס תופס מקום.`;
    };
    rows.bind(el, calc); calc();
  };

  // ---------- שיעור 5: Cache ----------
  W.cache = (el) => {
    const hit = slider(nid('h'), 'Cache hit ratio', { min: 0, max: 99, value: 80, show: (v) => v + '%' });
    const rps = slider(nid('q'), 'קריאות לשנייה', { min: 1000, max: 200000, value: 20000, log: true });
    el.innerHTML = `<div class="w-title">מה Cache עושה למערכת</div>
      <div class="w-desc">קריאה מ-Redis לוקחת כ-1ms. קריאה מבסיס הנתונים לוקחת כ-20ms. בסיס הנתונים עומד בעד 5,000 קריאות לשנייה. מה קורה כשמשנים את אחוז הפגיעות במטמון?</div>
      <div class="w-controls">${hit.html}${rps.html}</div><div class="w-out"></div><div class="w-note"></div>`;
    const calc = () => {
      const h = hit.read(el) / 100;
      const q = rps.read(el);
      const avg = h * 1 + (1 - h) * 21;
      const db = q * (1 - h);
      el.querySelector('.w-out').innerHTML = metric('זמן תגובה ממוצע', dur(avg), avg > 15 ? 'bad' : avg > 6 ? 'mid' : 'ok') +
        metric('קריאות ל-DB בשנייה', fmt(db), db > 5000 ? 'bad' : db > 3500 ? 'mid' : 'ok') +
        metric('עומס על ה-DB', Math.round((db / 5000) * 100) + '%', db > 5000 ? 'bad' : db > 3500 ? 'mid' : 'ok');
      el.querySelector('.w-note').innerHTML = db > 5000
        ? '🔥 ה-DB מוצף. אם ה-Cache יתרוקן פתאום (למשל אחרי restart), כל הקריאות יגיעו ל-DB בבת אחת. בגלל זה חשוב לחשוב גם על "Cache קר".'
        : `💡 שימי לב לקפיצה בין 90% ל-99%: העומס על ה-DB יורד <b>פי 10</b>. כל אחוז בקצה העליון שווה הרבה.`;
    };
    hit.bind(el, calc); rps.bind(el, calc); calc();
  };

  // ---------- שיעור 6: Consistent Hashing ----------
  W.hashring = (el) => {
    const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
    const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16; return h >>> 0; };
    const H = (s) => mix(fnv(s));
    const KEYS = Array.from({ length: 2000 }, (_, i) => 'user-' + i);
    const colors = ['#4b3f8f', '#e0644d', '#23845f', '#c98a12', '#2f6fb5', '#b54a8f', '#5a8a2f', '#8f5a2f', '#2f8f8a', '#6b6b6b'];
    let servers = ['A', 'B', 'C', 'D'];
    let vnodes = 1;
    let last = null;
    el.innerHTML = `<div class="w-title">Consistent Hashing מול hash % N</div>
      <div class="w-desc">2,000 משתמשים מפוזרים בין שרתים. מה קורה כשמוסיפים או מורידים שרת? בשיטת <code>hash % N</code> כמעט כולם זזים, וב-Consistent Hashing רק חלק קטן.</div>
      <div class="row" style="margin-bottom:12px"><button class="btn small" data-k="add">➕ הוספת שרת</button><button class="btn ghost small" data-k="rm">➖ הסרת שרת</button>
      <span class="seg"><button data-v="1" class="on">צומת אחד לשרת</button><button data-v="50">50 צמתים וירטואליים</button></span></div>
      <div class="ring-wrap"><svg viewBox="0 0 220 220" aria-label="טבעת hash"></svg><div><div class="w-out"></div><div class="w-note"></div></div></div>`;
    const svg = el.querySelector('svg');
    const ringOf = (list) => list.flatMap((s) => Array.from({ length: vnodes }, (_, v) => ({ s, h: H(s + '#' + v) }))).sort((a, b) => a.h - b.h);
    const ownerRing = (ring, k) => { const h = H(k); for (const p of ring) if (p.h >= h) return p.s; return ring[0].s; };
    const ownerMod = (list, k) => list[H(k) % list.length];
    const pos = (h, r) => { const a = (h / 4294967296) * Math.PI * 2 - Math.PI / 2; return [110 + r * Math.cos(a), 110 + r * Math.sin(a)]; };
    const draw = (moved) => {
      const ring = ringOf(servers);
      const owners = KEYS.map((k) => ownerRing(ring, k));
      const count = {}; owners.forEach((o) => { count[o] = (count[o] || 0) + 1; });
      let html = '<circle cx="110" cy="110" r="88" fill="none" stroke="var(--line)" stroke-width="10"/>';
      KEYS.slice(0, 260).forEach((k, i) => { const [x, y] = pos(H(k), 88); html += `<circle cx="${x}" cy="${y}" r="2" fill="${colors['ABCDEFGHIJ'.indexOf(owners[i])]}" opacity=".75"/>`; });
      ring.forEach((p) => { const [x, y] = pos(p.h, 88); html += `<circle cx="${x}" cy="${y}" r="${vnodes > 1 ? 3 : 7}" fill="${colors['ABCDEFGHIJ'.indexOf(p.s)]}" stroke="var(--surface)" stroke-width="1.5"/>`; });
      if (vnodes === 1) ring.forEach((p) => { const [x, y] = pos(p.h, 64); html += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${p.s}</text>`; });
      svg.innerHTML = html;
      const spread = servers.map((s) => count[s] || 0);
      el.querySelector('.w-out').innerHTML = metric('שרתים', servers.length) +
        metric('הכי עמוס / הכי פנוי', `${Math.max(...spread)} / ${Math.min(...spread)}`, Math.max(...spread) > 2.2 * Math.min(...spread) ? 'mid' : 'ok') +
        (moved ? metric('זזו ב-Consistent Hashing', moved.ring + '%', 'ok') + metric('היו זזים ב-hash % N', moved.mod + '%', 'bad') : '');
      el.querySelector('.w-note').innerHTML = moved
        ? `ב-Consistent Hashing זזו רק ~${moved.ring}% מהמפתחות (בערך 1/N, כצפוי). ב-<code>hash % N</code> היו זזים ${moved.mod}%, כלומר כמעט כל ה-Cache או ה-Shards היו צריכים לעבור.`
        : vnodes === 1 ? 'הנקודות הגדולות הן שרתים, והקטנות הן משתמשים. כל משתמש שייך לשרת הראשון שנמצא אחריו בכיוון השעון. שימי לב שהחלוקה לא אחידה: בגלל זה משתמשים בצמתים וירטואליים.' : 'עם 50 צמתים וירטואליים לכל שרת, החלוקה הרבה יותר אחידה.';
    };
    const change = (next) => {
      const ringA = ringOf(servers); const before = servers;
      servers = next;
      const ringB = ringOf(servers);
      let mr = 0; let mm = 0;
      KEYS.forEach((k) => { if (ownerRing(ringA, k) !== ownerRing(ringB, k)) mr++; if (ownerMod(before, k) !== ownerMod(servers, k)) mm++; });
      last = { ring: Math.round((mr / KEYS.length) * 100), mod: Math.round((mm / KEYS.length) * 100) };
      draw(last);
    };
    el.addEventListener('click', (e) => {
      const k = e.target.closest('[data-k]');
      const v = e.target.closest('[data-v]');
      if (k && k.dataset.k === 'add' && servers.length < 10) change([...servers, 'ABCDEFGHIJ'[servers.length]]);
      if (k && k.dataset.k === 'rm' && servers.length > 2) change(servers.slice(0, -1));
      if (v) { vnodes = Number(v.dataset.v); el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === v)); draw(null); }
    });
    draw(null);
  };

  // ---------- שיעור 7: CAP ----------
  W.cap = (el) => {
    const st = { A: { v: 'שלום', ver: 1 }, B: { v: 'שלום', ver: 1 }, partition: false, mode: 'CP', n: 1 };
    const words = ['מה נשמע?', 'נפגשים ב-8', 'מאחרת 5 דק\'', 'הגעתי!', 'יש פיצה?', 'תודה ❤️'];
    el.innerHTML = `<div class="w-title">ניסוי CAP: שני שרתים וניתוק רשת</div>
      <div class="w-desc">ההודעה האחרונה בצ'אט נשמרת בשני שרתים, A ו-B, שמסנכרנים ביניהם. מנתקים את הרשת ביניהם ובוחרים: CP (עקביות קודמת) או AP (זמינות קודמת).</div>
      <div class="row" style="margin-bottom:10px"><span class="seg" data-g="mode"><button data-mode="CP" class="on">CP: עקביות</button><button data-mode="AP">AP: זמינות</button></span>
      <button class="btn ghost small" data-k="part">✂️ ניתוק רשת</button></div>
      <div class="nodes"><div class="node" data-n="A"></div><div class="cut"></div><div class="node" data-n="B"></div></div>
      <div class="row" style="justify-content:center;margin-bottom:10px">
        <button class="btn small" data-k="wA">✍️ כתיבה ל-A</button><button class="btn small" data-k="wB">✍️ כתיבה ל-B</button>
        <button class="btn ghost small" data-k="rA">👀 קריאה מ-A</button><button class="btn ghost small" data-k="rB">👀 קריאה מ-B</button></div>
      <div class="log" aria-live="polite"></div>`;
    const log = el.querySelector('.log');
    const say = (cls, msg) => { log.innerHTML += `<div class="${cls}">${msg}</div>`; log.scrollTop = log.scrollHeight; };
    const draw = () => {
      ['A', 'B'].forEach((n) => { el.querySelector(`[data-n="${n}"]`).innerHTML = `<b>שרת ${n}</b><span class="v">"${st[n].v}"</span><br><span class="muted" style="font-size:12px">v${st[n].ver}</span>`; });
      el.querySelector('.cut').textContent = st.partition ? '⚡✂️⚡' : '⟷';
      el.querySelector('[data-k="part"]').textContent = st.partition ? '🔌 חיבור מחדש' : '✂️ ניתוק רשת';
    };
    const write = (n) => {
      const other = n === 'A' ? 'B' : 'A';
      const v = words[st.n++ % words.length];
      if (!st.partition) {
        const ver = Math.max(st.A.ver, st.B.ver) + 1;
        st[n] = { v, ver }; st[other] = { v, ver };
        say('ok', `✓ write "${v}" → ${n}, replicated to ${other}`);
      } else if (st.mode === 'CP') {
        say('bad', `✗ write to ${n} REJECTED: cannot reach ${other}. Refusing so the replicas never disagree. (C over A)`);
      } else {
        st[n] = { v, ver: st[n].ver + 1 };
        say('warn', `⚠ write "${v}" accepted by ${n} only. ${other} does not know yet. (A over C)`);
      }
      draw();
    };
    const read = (n) => {
      if (st.partition && st.mode === 'CP') { say('bad', `✗ read from ${n} → error 503: can't confirm this is the latest value`); return; }
      const other = n === 'A' ? 'B' : 'A';
      const stale = st.partition && st[n].ver < st[other].ver;
      say(stale ? 'warn' : 'ok', `${stale ? '⚠' : '✓'} read from ${n} → "${st[n].v}"${stale ? '  (STALE! someone wrote a newer message on ' + other + ')' : ''}`);
    };
    el.addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) { st.mode = m.dataset.mode; el.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === m)); say('', `— mode: ${st.mode} —`); return; }
      const k = e.target.closest('[data-k]'); if (!k) return;
      const a = k.dataset.k;
      if (a === 'part') {
        st.partition = !st.partition;
        if (st.partition) say('warn', '✂️ network partition! A and B cannot talk.');
        else {
          if (st.A.v !== st.B.v) {
            const win = st.A.ver >= st.B.ver ? 'A' : 'B';
            const lose = win === 'A' ? 'B' : 'A';
            say('warn', `🔌 healed. Conflict: A="${st.A.v}" B="${st.B.v}". Last-write-wins → keeping ${win}'s value, ${lose}'s write is LOST.`);
            st[lose] = { ...st[win] };
          } else say('ok', '🔌 healed. Replicas in sync.');
        }
        draw(); return;
      }
      if (a === 'wA') write('A'); if (a === 'wB') write('B'); if (a === 'rA') read('A'); if (a === 'rB') read('B');
    });
    draw();
    say('', 'Try: partition → write to A → read from B, in both modes.');
  };

  // ---------- שיעור 8: תור ----------
  W.queue = (el) => {
    const prod = slider(nid('p'), 'הודעות נכנסות לשנייה (Producers)', { min: 0, max: 3000, value: 500, step: 50 });
    const cons = slider(nid('c'), 'מספר Consumers (כל אחד מעבד 150 בשנייה)', { min: 1, max: 20, value: 4 });
    let len = 0; let spike = 0;
    el.innerHTML = `<div class="w-title">תור הודעות בפעולה</div>
      <div class="w-desc">שירות ההתראות של שיחון קורא הודעות מתור ושולח Push לטלפונים. מה קורה כשקצב הכניסה גבוה מקצב העיבוד?</div>
      <div class="w-controls">${prod.html}${cons.html}</div>
      <div class="row" style="margin-bottom:12px"><button class="btn ghost small" data-k="spike">⚡ שיא פתאומי ×5 (3 שניות)</button><button class="btn ghost small" data-k="clear">🧹 ריקון</button></div>
      <div class="grid-2"><div class="tank"><i></i><span></span></div><div class="w-out"></div></div><div class="w-note"></div>`;
    const tick = () => {
      if (!alive(el)) { clearInterval(timer); return; }
      const p = prod.read(el) * (spike > 0 ? 5 : 1);
      const c = cons.read(el) * 150;
      if (spike > 0) spike -= 0.2;
      len = Math.max(0, len + (p - c) * 0.2);
      const lag = c ? len / c : Infinity;
      el.querySelector('.tank i').style.height = Math.min(100, (len / 20000) * 100) + '%';
      el.querySelector('.tank span').textContent = fmt(Math.round(len)) + ' בתור';
      el.querySelector('.w-out').innerHTML = metric('נכנס לשנייה', fmt(p)) + metric('מעובד לשנייה', fmt(Math.min(c, p + len * 5))) +
        metric('עיכוב (lag)', dur(lag * 1000), lag > 10 ? 'bad' : lag > 2 ? 'mid' : 'ok');
      el.querySelector('.w-note').innerHTML = p > c
        ? '📈 התור גדל. ההודעות לא אובדות, הן מחכות, אבל ההתראות מתעכבות. אפשר להוסיף Consumers (scale out), או לקבל עיכוב זמני.'
        : len > 0 ? '📉 ה-Consumers מדביקים את הפער. התור "ספג" את השיא, ובשביל זה בדיוק הוא קיים.' : '✅ מאוזן. התור כמעט ריק והעיכוב זניח.';
    };
    const timer = setInterval(tick, 200);
    el.addEventListener('click', (e) => { const k = e.target.closest('[data-k]'); if (!k) return; if (k.dataset.k === 'spike') spike = 3; else len = 0; });
    prod.bind(el, () => {}); cons.bind(el, () => {});
    tick();
  };

  // ---------- שיעור 9: Rate limiting ----------
  W.ratelimit = (el) => {
    const cap = slider(nid('b'), 'גודל הדלי (burst)', { min: 1, max: 20, value: 5 });
    const rate = slider(nid('r'), 'מילוי: אסימונים לשנייה', { min: 1, max: 10, value: 2 });
    let tokens = 5;
    el.innerHTML = `<div class="w-title">Token Bucket: הגבלת קצב שליחת הודעות</div>
      <div class="w-desc">לכל משתמש יש "דלי" אסימונים. כל הודעה צורכת אסימון אחד, והדלי מתמלא בקצב קבוע. משתמש רגיל לא מרגיש את המגבלה, ובוט ספאם נחסם.</div>
      <div class="w-controls">${cap.html}${rate.html}</div>
      <div class="row" style="margin-bottom:10px"><button class="btn small" data-k="one">✉️ שליחת הודעה</button><button class="btn ghost small" data-k="bot">🤖 התקפת בוט: 20 הודעות</button></div>
      <div class="row" style="margin-bottom:10px"><b>אסימונים:</b><div class="tokens"></div></div><div class="log"></div>`;
    const log = el.querySelector('.log');
    const say = (cls, m) => { log.innerHTML += `<div class="${cls}">${m}</div>`; log.scrollTop = log.scrollHeight; };
    const draw = () => { el.querySelector('.tokens').innerHTML = '<i></i>'.repeat(Math.floor(tokens)); };
    const send = () => {
      if (tokens >= 1) { tokens -= 1; say('ok', `200 OK  (tokens left: ${Math.floor(tokens)})`); }
      else say('bad', '429 Too Many Requests  Retry-After: ' + (1 / rate.read(el)).toFixed(1) + 's');
      draw();
    };
    const timer = setInterval(() => {
      if (!alive(el)) { clearInterval(timer); return; }
      tokens = Math.min(cap.read(el), tokens + rate.read(el) / 10);
      draw();
    }, 100);
    el.addEventListener('click', (e) => {
      const k = e.target.closest('[data-k]'); if (!k) return;
      if (k.dataset.k === 'one') send();
      else for (let i = 0; i < 20; i++) send();
    });
    cap.bind(el, () => { tokens = Math.min(tokens, cap.read(el)); draw(); }); rate.bind(el, () => {});
    draw();
  };

  // ---------- שיעור 10: Polling מול WebSocket ----------
  W.realtime = (el) => {
    const users = slider(nid('u'), 'משתמשים מחוברים', { min: 1000, max: 5e7, value: 1e6, log: true });
    const every = slider(nid('i'), 'Polling: בדיקה כל X שניות', { min: 1, max: 30, value: 3, show: (v) => v + 's' });
    const msgs = slider(nid('m'), 'הודעות שמשתמש מקבל בשעה', { min: 1, max: 300, value: 30 });
    el.innerHTML = `<div class="w-title">Polling מול WebSocket: כמה זה עולה?</div>
      <div class="w-desc">ב-Polling כל לקוח שואל כל כמה שניות "יש משהו חדש?". ב-WebSocket החיבור נשאר פתוח והשרת דוחף הודעה רק כשיש כזו.</div>
      <div class="w-controls">${users.html}${every.html}${msgs.html}</div><div class="w-out"></div><div class="w-note"></div>`;
    const calc = () => {
      const u = users.read(el); const i = every.read(el); const m = msgs.read(el);
      const pollRps = u / i;
      const realRps = (u * m) / 3600;
      const useful = Math.min(100, (realRps / pollRps) * 100);
      el.querySelector('.w-out').innerHTML = metric('Polling: בקשות לשנייה', fmt(pollRps), 'bad') + metric('מתוכן עם תוכן חדש', useful.toFixed(1) + '%', useful < 10 ? 'bad' : 'mid') +
        metric('Polling: עיכוב ממוצע', (i / 2).toFixed(1) + 's', i > 4 ? 'bad' : 'mid') + metric('WebSocket: הודעות לשנייה', fmt(realRps), 'ok') + metric('WebSocket: עיכוב', '~0.1s', 'ok') + metric('חיבורים פתוחים', fmt(u), 'mid');
      el.querySelector('.w-note').innerHTML = `ב-Polling, <b>${(100 - useful).toFixed(0)}%</b> מהבקשות חוזרות ריקות, וזה בזבוז של סוללה, רשת ושרתים. ב-WebSocket המחיר הוא אחר: ${fmt(u)} חיבורים פתוחים כל הזמן, שכל אחד מהם תופס זיכרון בשרת.`;
    };
    [users, every, msgs].forEach((x) => x.bind(el, calc)); calc();
  };

  // ---------- שיעור 12: זמינות ----------
  W.availability = (el) => {
    const avail = [99, 99.5, 99.9, 99.95, 99.99];
    const series = slider(nid('n'), 'רכיבים בשרשרת (כל בקשה עוברת בכולם)', { min: 1, max: 8, value: 4 });
    const redund = slider(nid('r'), 'עותקים מכל רכיב (redundancy)', { min: 1, max: 3, value: 1 });
    el.innerHTML = `<div class="w-title">מחשבון ה"תשיעיות"</div>
      <div class="w-desc">כל רכיב זמין X% מהזמן. בקשה עוברת דרך כמה רכיבים בשרשרת (LB → API → Cache → DB). מה הזמינות הכוללת, ומה קורה כשמוסיפים עותקים?</div>
      <div class="field"><label>זמינות של כל רכיב</label><span class="seg" data-g="a">${avail.map((a) => `<button data-a="${a}" class="${a === 99.9 ? 'on' : ''}">${a}%</button>`).join('')}</span></div>
      <div class="w-controls">${series.html}${redund.html}</div><div class="w-out"></div><div class="w-note"></div>`;
    let a = 99.9;
    const calc = () => {
      const n = series.read(el); const r = redund.read(el);
      const p = a / 100;
      const comp = 1 - (1 - p) ** r;
      const total = comp ** n;
      const downYear = (1 - total) * 365 * 24 * 60;
      el.querySelector('.w-out').innerHTML = metric('זמינות כוללת', (total * 100).toFixed(4) + '%', total < 0.999 ? 'bad' : total < 0.9999 ? 'mid' : 'ok') +
        metric('השבתה בשנה', dur(downYear * 60000), downYear > 525 ? 'bad' : downYear > 52 ? 'mid' : 'ok') + metric('השבתה בחודש', dur((downYear / 12) * 60000));
      el.querySelector('.w-note').innerHTML = r === 1
        ? `שרשרת של רכיבים <b>מכפילה</b> את הסיכון: ${n} רכיבים של ${a}% נותנים רק ${(total * 100).toFixed(2)}%. נסי להוסיף עותקים.`
        : `עם ${r} עותקים, רכיב נופל רק אם כל העותקים שלו נופלים יחד. זה הכוח של redundancy, בתנאי שהכשלים לא קשורים זה לזה (למשל לא באותו ארון חשמל).`;
    };
    el.querySelector('[data-g="a"]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      a = Number(b.dataset.a);
      el.querySelectorAll('[data-a]').forEach((x) => x.classList.toggle('on', x === b));
      calc();
    });
    series.bind(el, calc); redund.bind(el, calc); calc();
  };

  // ---------- שיעור 12: Retry storm ----------
  W.retry = (el) => {
    const retries = slider(nid('t'), 'כמה ניסיונות חוזרים כל לקוח עושה', { min: 0, max: 5, value: 3 });
    const layers = slider(nid('l'), 'שכבות שירותים שכל אחת עושה retry', { min: 1, max: 4, value: 3 });
    let mode = 'naive';
    el.innerHTML = `<div class="w-title">סערת Retries</div>
      <div class="w-desc">ה-DB מתחיל להאט. כל שכבה (אפליקציה → API → שירות → DB) עושה retry משלה. כמה בקשות מגיעות בפועל ל-DB על כל לחיצה של משתמש?</div>
      <div class="w-controls">${retries.html}${layers.html}</div>
      <div class="seg" style="margin-bottom:12px"><button data-m="naive" class="on">retry מיידי</button><button data-m="smart">backoff + jitter + circuit breaker</button></div>
      <div class="w-out"></div><div class="w-note"></div>`;
    const calc = () => {
      const t = retries.read(el); const l = layers.read(el);
      const amp = (t + 1) ** l;
      el.querySelector('.w-out').innerHTML = mode === 'naive'
        ? metric('בקשות ל-DB לכל לחיצה', '×' + fmt(amp), amp > 10 ? 'bad' : amp > 3 ? 'mid' : 'ok') + metric('עומס על DB שכבר מתקשה', fmt(amp * 1000) + ' rps', amp > 10 ? 'bad' : 'mid')
        : metric('בקשות ל-DB לכל לחיצה', '×' + Math.min(t + 1, 2), 'ok') + metric('עומס', 'מתפזר לאורך זמן', 'ok');
      el.querySelector('.w-note').innerHTML = mode === 'naive'
        ? `ניסיונות חוזרים <b>מוכפלים</b> בין השכבות: (${t}+1)<sup>${l}</sup> = ${fmt(amp)}. DB שהאט קצת מקבל פי ${fmt(amp)} עומס, וזה מה שגורם לו לקרוס לגמרי. כך נוצר Cascading Failure.`
        : 'עם retry רק בשכבה אחת, המתנה שגדלה בכל ניסיון (exponential backoff), פיזור אקראי (jitter), ו-Circuit Breaker שמפסיק לנסות כשרואים שהשירות למטה, ה-DB מקבל זמן להתאושש.';
    };
    el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); calc();
    });
    retries.bind(el, calc); layers.bind(el, calc); calc();
  };

  // שני קונים על המקום האחרון: צעד אחרי צעד, בכל אחת מארבע הגישות
  W.race = (el) => {
    const MODES = {
      naive: {
        label: 'בלי הגנה',
        steps: [
          ['A', 'SELECT seats → 1', 'רואה שנשאר מקום אחד'],
          ['B', 'SELECT seats → 1', 'גם B רואה מקום אחד, כי A עוד לא כתב'],
          ['A', 'UPDATE seats = 0', 'A "קנה"'],
          ['B', 'UPDATE seats = 0', 'B "קנה" גם הוא. הכתיבה שלו דורסת את של A'],
        ],
        end: ['bad', '2 כרטיסים נמכרו על מקום אחד', 'זה Race Condition קלאסי: הבדיקה והכתיבה הן שתי פעולות נפרדות, ובין שתיהן העולם השתנה. בבדיקות מקומיות זה כמעט לא קורה. בעומס של אלפי קליקים בשנייה, זה קורה כל הזמן.'],
      },
      pessimistic: {
        label: 'נעילה (FOR UPDATE)',
        steps: [
          ['A', 'SELECT … FOR UPDATE → 1', 'A נועל את השורה'],
          ['B', 'SELECT … FOR UPDATE ⏳', 'B מחכה. השורה נעולה'],
          ['A', 'UPDATE seats = 0; COMMIT', 'A קנה ושחרר את הנעילה'],
          ['B', '… → 0', 'B ממשיך, רואה 0 ומקבל "אזל"'],
        ],
        end: ['ok', 'כרטיס אחד, נכון', 'נכון ופשוט. המחיר: כל הקונים מחכים בתור על אותה שורה. עם 80,000 קליקים זה צוואר בקבוק, ונעילות שמוחזקות זמן רב (למשל בזמן קריאה לחברת אשראי) הורגות את התפוקה.'],
      },
      optimistic: {
        label: 'אופטימית (version)',
        steps: [
          ['A', 'SELECT seats, version → 1, v7', ''],
          ['B', 'SELECT seats, version → 1, v7', 'אין נעילה, שניהם קוראים'],
          ['A', 'UPDATE … WHERE version = 7 → 1 row', 'A הצליח, version = 8'],
          ['B', 'UPDATE … WHERE version = 7 → 0 rows', 'B נכשל: מישהו שינה בינתיים. קורא שוב, רואה 0, "אזל"'],
        ],
        end: ['ok', 'כרטיס אחד, נכון', 'אף אחד לא מחכה. מצוין כשהתנגשויות נדירות (עריכת פרופיל). אבל כשכולם מתנגשים על אותה שורה, רוב הניסיונות נכשלים ונשלחים שוב, וזה בזבוז. ב-JPA זה פשוט @Version.'],
      },
      atomic: {
        label: 'עדכון מותנה',
        steps: [
          ['A', 'UPDATE seats = seats - 1 WHERE seats > 0 → 1 row', 'הבדיקה והכתיבה בפעולה אחת'],
          ['B', 'UPDATE seats = seats - 1 WHERE seats > 0 → 0 rows', '0 שורות עודכנו: אזל'],
        ],
        end: ['ok', 'כרטיס אחד, נכון, ומהר', 'כשאפשר לבטא את כל הכלל בתנאי אחד, ה-DB דואג לאטומיות בעצמו. בלי נעילה מפורשת ובלי ניסיון חוזר. זו בדרך כלל ברירת המחדל הכי טובה למונים ולמלאי.'],
      },
    };
    let mode = 'naive';
    let step = 0;
    el.innerHTML = `<div class="w-title">מרוץ על המקום האחרון</div>
      <div class="w-desc">נשאר מקום אחד. A ו-B לוחצים "קני" באותה מילי-שנייה. לחצי "הצעד הבא" ותראי מה קורה בכל גישה.</div>
      <div class="seg" style="margin-bottom:12px">${Object.entries(MODES).map(([k, m]) => `<button data-m="${k}"${k === mode ? ' class="on"' : ''}>${m.label}</button>`).join('')}</div>
      <div class="race"></div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn small" data-step>הצעד הבא ←</button><button type="button" class="btn ghost small" data-reset>מההתחלה</button></div>
      <div class="w-out" style="margin-top:12px"></div><div class="w-note"></div>`;
    const draw = () => {
      const m = MODES[mode];
      el.querySelector('.race').innerHTML = m.steps.map(([who, sql, note], i) => `<div class="race-row ${i < step ? 'shown' : ''} who-${who}">
        <span class="race-who">${who}</span><code>${sql}</code><span class="race-note">${i < step ? note : ''}</span></div>`).join('');
      const done = step >= m.steps.length;
      el.querySelector('[data-step]').disabled = done;
      el.querySelector('.w-out').innerHTML = done ? `<div class="m ${m.end[0]}"><b>${m.end[0] === 'ok' ? '✓' : '✗'}</b><span>${m.end[1]}</span></div>` : '';
      el.querySelector('.w-note').innerHTML = done ? m.end[2] : `צעד ${step} מתוך ${m.steps.length}`;
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b) { mode = b.dataset.m; step = 0; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); draw(); return; }
      if (e.target.closest('[data-step]')) { step++; draw(); }
      if (e.target.closest('[data-reset]')) { step = 0; draw(); }
    });
    draw();
  };

  // משימה ארוכה: מה המשתמש חווה בכל גישה
  W.longtask = (el) => {
    const dur = slider(nid('d'), 'כמה זמן לוקחת המשימה (שניות)', { min: 1, max: 600, value: 90, log: true });
    const fail = slider(nid('f'), 'אחוז הסיכוי שהשרת יופעל מחדש באמצע', { min: 0, max: 30, value: 5, show: (v) => v + '%' });
    let mode = 'sync';
    el.innerHTML = `<div class="w-title">ייצוא של היסטוריית צ'אט</div>
      <div class="w-desc">משתמשת מבקשת לייצא את כל ההיסטוריה של קבוצה (ZIP עם הודעות ותמונות). מה קורה בכל גישה?</div>
      <div class="w-controls">${dur.html}${fail.html}</div>
      <div class="seg" style="margin-bottom:12px"><button data-m="sync" class="on">בתוך בקשת HTTP</button><button data-m="async">202 + תור + סטטוס</button><button data-m="steps">תור + צעדים עם checkpoint</button></div>
      <div class="w-out"></div><div class="w-note"></div>`;
    const calc = () => {
      const d = dur.read(el); const f = fail.read(el) / 100;
      const out = el.querySelector('.w-out'); const note = el.querySelector('.w-note');
      if (mode === 'sync') {
        const timeout = d > 30;
        out.innerHTML = metric('המשתמשת מחכה', timeout ? 'Timeout' : d + ' s', timeout ? 'bad' : d > 5 ? 'mid' : 'ok')
          + metric('thread תפוס בשרת', d + ' s', d > 5 ? 'bad' : 'mid') + metric('סיכוי להתחיל מאפס', Math.round(f * 100) + '%', f > 0 ? 'mid' : 'ok');
        note.innerHTML = timeout ? 'רוב ה-Load Balancers וה-Gateways סוגרים חיבור אחרי 30–60 שניות. המשימה אולי ממשיכה לרוץ בשרת, אבל המשתמשת קיבלה שגיאה ותלחץ שוב. עכשיו רצות שתיים.' : 'למשימה קצרה זה סביר. אבל כל thread שמחכה הוא thread שלא משרת בקשות אחרות.';
      } else if (mode === 'async') {
        out.innerHTML = metric('המשתמשת מחכה', '< 100 ms', 'ok') + metric('thread תפוס ב-API', '~0', 'ok') + metric('עבודה שהולכת לאיבוד בתקלה', Math.round(d / 2) + ' s בממוצע', f > 0 ? 'mid' : 'ok');
        note.innerHTML = 'השרת מחזיר מיד <code>202 Accepted</code> עם מזהה משימה, ו-Worker מבצע אותה מהתור. הלקוח שואל על הסטטוס, או מקבל התראה כשהיא מוכנה. אם ה-Worker נופל, התור מחזיר את המשימה, אבל היא מתחילה מההתחלה.';
      } else {
        out.innerHTML = metric('המשתמשת מחכה', '< 100 ms', 'ok') + metric('עבודה שהולכת לאיבוד בתקלה', '≤ צעד אחד', 'ok') + metric('מורכבות', 'גבוהה יותר', 'mid');
        note.innerHTML = 'המשימה מחולקת לצעדים (לאסוף הודעות, להוריד תמונות, לדחוס, להעלות), וכל צעד שהסתיים נשמר. תקלה מחזירה רק לצעד האחרון. זה בדיוק מה ש-Workflow Engine כמו Temporal נותן מהקופסה.';
      }
    };
    el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); calc();
    });
    dur.bind(el, calc); fail.bind(el, calc); calc();
  };

  window.SDC_WIDGETS = W;
})();
