(() => {
  'use strict';

  const { lessons, glossary: G, weeks, patterns: PATTERNS = [], patternQuiz: PQUIZ = [], practice: PRACTICE = [], cheatsheet: CHEAT = null } = window.SDC;
  const STATE_KEY = 'sdc-state-v1';
  const THEME_KEY = 'sdc-theme';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#main');
  const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
  const LEVELS = [
    { min: 0, name: '🌱 Junior', desc: 'מתחילות את המסע' },
    { min: 4, name: '🌿 Mid-level', desc: 'היסודות במקום' },
    { min: 8, name: '🌳 Senior', desc: 'מבינה איך נתונים גדלים' },
    { min: 12, name: '🏔️ Staff', desc: 'רואה את התמונה המלאה' },
    { min: lessons.length, name: '🏛️ Architect', desc: 'סיימת את כל המסע!' },
  ];
  const CONFIDENCE = { sure: 'בטוחה', unsure: 'מתלבטת', guess: 'מנחשת' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lessonById = (id) => lessons.find((l) => l.id === Number(id));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* מצב פרטי */ } };

  // ---------- אינדקס שאלות ----------
  const QINDEX = {};
  lessons.forEach((l) => {
    [...(l.quiz || []), ...(l.review || [])].forEach((q) => { QINDEX[q.id] = { q, lesson: l }; });
  });
  const PQ_LESSON = { id: 0, title: 'בוחן זיהוי תבניות' };
  PQUIZ.forEach((q) => { QINDEX[q.id] = { q, lesson: PQ_LESSON }; });

  // ---------- מצב ----------
  const blank = () => ({ completed: {}, quiz: {}, exercises: {}, reflections: {}, predictions: {}, work: {}, practice: {}, mine: [], visits: [], nextLesson: null, updatedAt: 0 });
  let state = (() => {
    try { return { ...blank(), ...JSON.parse(safeGet(STATE_KEY) || '{}') }; } catch { return blank(); }
  })();

  function save({ sync = true } = {}) {
    state.updatedAt = Date.now();
    state.nextLesson = nextLesson() ? { id: nextLesson().id, title: nextLesson().title } : null;
    safeSet(STATE_KEY, JSON.stringify(state));
    updateChrome();
    if (sync) Sync.schedule();
  }

  function nextLesson() {
    return lessons.find((l) => !state.completed[l.id]) || null;
  }
  const doneCount = () => lessons.filter((l) => state.completed[l.id]).length;
  const activeMine = () => state.mine.filter((m) => !m.deleted);
  const level = () => [...LEVELS].reverse().find((lv) => doneCount() >= lv.min);
  const weakQuestions = () => Object.entries(state.quiz)
    .filter(([id, r]) => QINDEX[id] && (!r.ok || r.conf === 'guess'))
    .map(([id]) => id);

  function quizStats() {
    const all = Object.values(state.quiz);
    const ok = all.filter((r) => r.ok).length;
    return { total: all.length, ok, pct: all.length ? Math.round((ok / all.length) * 100) : 0 };
  }

  function markVisit() {
    const today = new Date().toISOString().slice(0, 10);
    if (!state.visits.includes(today)) {
      state.visits.push(today);
      state.visits = state.visits.slice(-120);
      save();
    }
  }

  // ---------- סנכרון לשרת ----------
  // ההזדהות היא עוגיית סשן שנוצרת בדף /login, והדפדפן שולח אותה אוטומטית
  const Sync = {
    timer: null,
    online: false,
    setStatus(text, kind = '') {
      const el = $('#syncStatus');
      el.innerHTML = text ? `<span class="status-dot ${kind}"></span>${esc(text)}` : '';
    },
    async api(path, opts = {}) {
      const res = await fetch('/api' + path, {
        ...opts,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      });
      if (res.status === 401) {
        // הסשן פג: חוזרים לדף הכניסה, ואחריו לאותו מקום באתר
        location.href = '/login';
        throw Object.assign(new Error('unauthorized'), { code: 401 });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { code: res.status, data });
      return data;
    },
    async start() {
      try {
        const remote = await this.api('/state');
        if (remote && remote.updatedAt) {
          state = merge(state, remote);
          safeSet(STATE_KEY, JSON.stringify(state));
        }
        this.online = true;
        await this.push();
        this.api('/visit', { method: 'POST' }).catch(() => {});
        this.setStatus('מסונכרן לענן', 'on');
        render();
      } catch (e) {
        if (e.code !== 401) this.setStatus('אין חיבור לשרת · נשמר מקומית', 'off');
      }
    },
    schedule() {
      if (!this.online) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push().catch(() => this.setStatus('הסנכרון נכשל · נשמר מקומית', 'off')), 1500);
    },
    async push() {
      if (!this.online) return;
      await this.api('/state', { method: 'PUT', body: JSON.stringify(state) });
      this.setStatus('מסונכרן לענן', 'on');
    },
  };

  function merge(a, b) {
    const newer = (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
    const older = newer === a ? b : a;
    const out = { ...blank(), ...older, ...newer };
    for (const k of ['completed', 'exercises', 'reflections', 'predictions', 'work', 'practice']) out[k] = { ...(older[k] || {}), ...(newer[k] || {}) };
    out.quiz = { ...(older.quiz || {}) };
    for (const [id, r] of Object.entries(newer.quiz || {})) {
      if (!out.quiz[id] || (r.at || 0) >= (out.quiz[id].at || 0)) out.quiz[id] = r;
    }
    const mine = new Map();
    for (const m of [...(older.mine || []), ...(newer.mine || [])]) {
      const cur = mine.get(m.id);
      if (!cur || (m.updatedAt || 0) >= (cur.updatedAt || 0)) mine.set(m.id, m);
    }
    out.mine = [...mine.values()];
    out.visits = [...new Set([...(older.visits || []), ...(newer.visits || [])])].sort().slice(-120);
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
    return out;
  }

  // ---------- עזרי תוכן ----------
  function rich(html, ctx) {
    return String(html || '').replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (m, key, text) => {
      const g = G[key];
      if (!g) { console.warn('מונח חסר במילון:', key); return text || key; }
      const label = text || g.en;
      if (ctx && ctx.doc) { ctx.terms.add(key); return `<b class="term-doc">${label}</b>`; }
      return `<a class="term" href="#/glossary/${key}" data-term="${key}">${label}</a>`;
    });
  }

  function table(t, ctx) {
    if (!t) return '';
    return `<div class="table-wrap"><table><thead><tr>${t.head.map((h) => `<th>${rich(h, ctx)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${rich(c, ctx)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function blockTitle(icon, title, sub) {
    return `<div class="block-title"><span class="b-icon">${icon}</span><div><h2>${title}</h2>${sub ? `<div class="b-sub">${sub}</div>` : ''}</div></div>`;
  }

  // ---------- שאלות ----------
  function questionHTML(q, num, { from, doc, ctx } = {}) {
    const fromLesson = from ? `<div class="q-from">🔁 משיעור ${from.id}: ${esc(from.title)}</div>` : '';
    if (doc) {
      return `<div class="q">${fromLesson}<div class="q-head"><span class="q-num">${num}.</span><div class="q-text">${rich(q.q, ctx)}</div></div>
        <div class="opts">${q.options.map((o, i) => `<div class="opt ${i === q.answer ? 'correct' : ''}"><span class="letter">${LETTERS[i]}</span><span>${rich(o, ctx)}<span class="why">${rich(q.explain[i], ctx)}</span></span></div>`).join('')}</div>
        ${q.hint ? `<div class="q-hint">${rich(q.hint, ctx)}</div>` : ''}</div>`;
    }
    const prev = state.quiz[q.id];
    const prevNote = prev ? `<span class="chip">${prev.ok ? '✓ בפעם הקודמת ענית נכון' : '↺ בפעם הקודמת זה היה קשה'}</span>` : '';
    return `<div class="q" data-qid="${q.id}">
      ${fromLesson}
      <div class="q-head"><span class="q-num">${num}.</span><div class="q-text">${rich(q.q)}</div></div>
      <div class="opts">${q.options.map((o, i) => `<button type="button" class="opt" data-i="${i}"><span class="letter">${LETTERS[i]}</span><span>${rich(o)}<span class="why" hidden></span></span></button>`).join('')}</div>
      <div class="confidence">כמה את בטוחה?
        ${Object.entries(CONFIDENCE).map(([k, v]) => `<button type="button" data-conf="${k}">${v}</button>`).join('')}
      </div>
      <div class="q-actions">
        <button type="button" class="btn small" data-act="check">בדיקה</button>
        ${q.hint ? '<button type="button" class="btn ghost small" data-act="hint">💡 רמז</button>' : ''}
        <button type="button" class="btn ghost small" data-act="reveal">הצגת התשובה וההסבר</button>
        <button type="button" class="btn ghost small" data-act="ask">✨ פרומפט לקלוד על השאלה</button>
        <span class="spacer"></span>${prevNote}
      </div>
      ${q.hint ? `<div class="q-hint" hidden>${rich(q.hint)}</div>` : ''}
      <div class="q-result" hidden></div>
    </div>`;
  }

  function onQuizClick(e) {
    const qEl = e.target.closest('.q[data-qid]');
    if (!qEl) return false;
    const { q, lesson } = QINDEX[qEl.dataset.qid];
    const opt = e.target.closest('.opt');
    const conf = e.target.closest('[data-conf]');
    const act = e.target.closest('[data-act]');
    if (e.target.closest('a.term')) return false;

    if (opt && !qEl.dataset.done) {
      $$('.opt', qEl).forEach((o) => o.classList.toggle('selected', o === opt));
      return true;
    }
    if (conf && !qEl.dataset.done) {
      $$('[data-conf]', qEl).forEach((b) => b.classList.toggle('on', b === conf));
      return true;
    }
    if (!act) return false;
    const a = act.dataset.act;
    if (a === 'hint') { $('.q-hint', qEl).hidden = false; act.disabled = true; return true; }
    if (a === 'ask') { copyText(questionPrompt(q, lesson), 'הפרומפט הועתק, אפשר להדביק בקלוד'); return true; }
    if (a === 'check' || a === 'reveal') {
      if (qEl.dataset.done) return true;
      const sel = $('.opt.selected', qEl);
      if (a === 'check' && !sel) { toast('קודם בוחרים תשובה 🙂'); return true; }
      const choice = sel ? Number(sel.dataset.i) : null;
      const confSel = $('[data-conf].on', qEl);
      const ok = a === 'check' && choice === q.answer;
      qEl.dataset.done = '1';
      $$('.opt', qEl).forEach((o) => {
        const i = Number(o.dataset.i);
        o.disabled = true;
        if (i === q.answer) o.classList.add('correct');
        else if (i === choice) o.classList.add('wrong');
        const why = $('.why', o);
        why.innerHTML = rich(q.explain[i]);
        why.hidden = false;
      });
      $$('.q-actions [data-act="check"], .q-actions [data-act="reveal"]', qEl).forEach((b) => { b.disabled = true; });
      const res = $('.q-result', qEl);
      res.hidden = false;
      if (a === 'reveal') {
        res.className = 'q-result bad';
        res.innerHTML = '📖 הנה התשובה וההסבר לכל אפשרות. השאלה תחזור באחד השיעורים הבאים כדי לוודא שהיא יושבת טוב.';
      } else if (ok) {
        res.className = 'q-result good';
        res.innerHTML = confSel && confSel.dataset.conf === 'guess'
          ? '✓ נכון! אבל סימנת שניחשת, אז השאלה תחזור בחזרה הבאה. כדאי לקרוא את ההסברים.'
          : '✓ נכון! כדאי לקרוא גם למה האפשרויות האחרות פחות טובות, שם הלמידה האמיתית.';
      } else {
        res.className = 'q-result bad';
        res.innerHTML = '✗ לא הפעם. קראי את ההסבר ליד כל אפשרות. בדרך כלל הטעות מלמדת יותר מהתשובה.';
      }
      state.quiz[q.id] = {
        ok,
        conf: a === 'reveal' ? 'revealed' : (confSel ? confSel.dataset.conf : null),
        at: Date.now(),
        attempts: ((state.quiz[q.id] || {}).attempts || 0) + 1,
      };
      save();
      updateScore(qEl.closest('.quiz'));
      return true;
    }
    return false;
  }

  function updateScore(quizEl) {
    if (!quizEl) return;
    const qs = $$('.q[data-qid]', quizEl);
    const done = qs.filter((q) => q.dataset.done);
    const box = $('.score-box', quizEl.parentElement);
    if (!box || done.length !== qs.length) return;
    const ok = done.filter((q) => $('.q-result.good', q)).length;
    box.hidden = false;
    box.innerHTML = `<b>${ok} / ${qs.length}</b>${ok === qs.length ? 'מושלם! 🎉' : ok >= qs.length / 2 ? 'יפה מאוד, השאלות שהיו קשות יחזרו בחזרות הבאות.' : 'זה בדיוק השלב שבו לומדים. כדאי לעבור שוב על ההסברים ולהוסיף מושגים לא ברורים למאגר.'}`;
  }

  function pickRecap(lesson) {
    if (lesson.id === 1) return [];
    const prev = lessonById(lesson.id - 1);
    const weak = new Set(weakQuestions());
    const earlier = lessons.filter((l) => l.id < lesson.id - 1).flatMap((l) => l.quiz);
    const fromPrev = [...prev.quiz].sort((a, b) => (weak.has(b.id) ? 1 : 0) - (weak.has(a.id) ? 1 : 0)).slice(0, 2);
    let older = earlier.filter((q) => weak.has(q.id));
    if (!older.length) older = earlier;
    const third = older.length ? [older[(lesson.id * 7) % older.length]] : [];
    return [...fromPrev, ...third].map((q) => ({ q, from: QINDEX[q.id].lesson }));
  }

  // ---------- שיעור ----------
  function lessonBody(lesson, { doc = false } = {}) {
    const ctx = doc ? { doc: true, terms: new Set() } : null;
    const r = (h) => rich(h, ctx);
    const blocks = [];
    const push = (id, tocTitle, html) => blocks.push({ id, tocTitle, html });

    if (!doc && lesson.id > 1) {
      const recap = pickRecap(lesson);
      push('recap', '☕ חימום', `${blockTitle('☕', 'חימום: חזרה קצרה', '3 שאלות משיעורים קודמים, כדי שהחומר יישאר')}
        <div class="quiz">${recap.map((x, i) => questionHTML(x.q, i + 1, { from: x.from })).join('')}</div>`);
    }

    push('crisis', '🚨 המשבר', `<div class="crisis">${lesson.crisis.time ? `<span class="time">${esc(lesson.crisis.time)}</span>` : ''}<h2>${lesson.crisis.title}</h2>${r(lesson.crisis.html)}</div>`);

    if (lesson.predict) {
      push('predict', '🤔 מה את היית עושה?', `${blockTitle('🤔', 'רגע לפני ההסבר: מה את היית עושה?', 'ניחוש של דקה. בסוף השיעור נחזור אליו')}
        <div class="card content predict"><p>${r(lesson.predict)}</p>
        ${doc ? '<p class="muted">✍️ כתבי כאן את התשובה שלך לפני שממשיכים לקרוא.</p>' : `<textarea class="reflect" data-predict="${lesson.id}" placeholder="מה הייתי עושה, ולמה. אין תשובה לא נכונה.">${esc(state.predictions[lesson.id] || '')}</textarea>`}</div>`);
    }

    lesson.sections.forEach((s, i) => {
      push(`s${i + 1}`, s.title, `${blockTitle(s.icon || '🧠', s.title, s.sub || '')}<div class="card content">${
        doc ? r(s.html).replace(/<div class="widget"[^>]*><\/div>/g, '<div class="callout">🎛️ בשיעור באתר יש כאן סימולציה אינטראקטיבית.</div>') : r(s.html)
      }</div>`);
    });

    if (lesson.tradeoffs) {
      push('tradeoffs', '⚖️ Trade-offs', `${blockTitle('⚖️', lesson.tradeoffs.title || 'Trade-offs: מתי כן ומתי לא', 'אין פתרון מושלם, יש פתרון שמתאים להקשר')}
        <div class="card content">${lesson.tradeoffs.intro ? `<p>${r(lesson.tradeoffs.intro)}</p>` : ''}${table(lesson.tradeoffs, ctx)}</div>`);
    }

    push('phrases', '🗣️ לדבר כמו ארכיטקטית', `${blockTitle('🗣️', 'לדבר כמו ארכיטקטית', 'משפטים שאפשר להביא לישיבת הדיזיין הבאה')}
      <div class="phrases">${lesson.phrases.map((p) => `<div class="phrase"><span class="say">"${r(p.say)}"</span><span class="when">${r(p.when)}</span></div>`).join('')}</div>`);

    const ex = lesson.exercise;
    push('exercise', '✏️ תרגיל תכנון', `${blockTitle('✏️', 'תרגיל תכנון: ' + ex.title, 'חושבים לבד קודם, ורק אחר כך מציצים')}
      <div class="card exercise content">${r(ex.html)}
        ${doc ? '' : `<textarea data-ex="${lesson.id}" placeholder="כאן כותבים את התכנון שלך. הוא נשמר אוטומטית.">${esc(state.exercises[lesson.id] || '')}</textarea>`}
        ${(ex.hints || []).map((h, i) => `<details class="reveal"${doc ? ' open' : ''}><summary>רמז ${i + 1}</summary><div>${r(h)}</div></details>`).join('')}
        <details class="reveal solution"${doc ? ' open' : ''}><summary>✅ פתרון לדוגמה</summary><div>${r(ex.solution)}</div></details>
      </div>`);

    push('quiz', '✅ בוחן', `${blockTitle('✅', 'בוחן', 'שאלות שמחייבות לחשוב. לכל אפשרות יש הסבר')}
      <div class="quiz">${lesson.quiz.map((q, i) => questionHTML(q, i + 1, { doc, ctx })).join('')}</div>
      ${doc ? '' : '<div class="score-box" hidden></div>'}`);

    if (lesson.review) {
      push('review', '🎯 Design Review', `${blockTitle('🎯', 'Design Review עם ה-CTO', 'מבחן מסכם לשבוע. שאלות קשות יותר שמחברות בין שיעורים')}
        <div class="review-intro"><span class="avatar">🧔</span><div><b>דני, ה-CTO של שיחון:</b> ${r(lesson.reviewIntro || 'בואי נעבור על ההחלטות שלך. אני אשאל שאלות קשות, וזה לגמרי בכוונה.')}</div></div>
        <div class="quiz">${lesson.review.map((q, i) => questionHTML(q, i + 1, { doc, ctx })).join('')}</div>
        ${doc ? '' : '<div class="score-box" hidden></div>'}`);
    }

    if (lesson.further) {
      push('further', '📚 לקריאה נוספת', `${blockTitle('📚', 'לקריאה נוספת', 'מקורות אמיתיים מהתעשייה, למי שרוצה להעמיק')}
        <div class="card content"><ul class="further">${lesson.further.map((f) => `<li><a href="https://www.google.com/search?q=${encodeURIComponent(f.search || f.title)}" target="_blank" rel="noopener">${esc(f.title)}</a> <span class="muted">· ${esc(f.source)}</span><div class="soft">${r(f.why)}</div></li>`).join('')}</ul>
        ${doc ? '' : '<p class="muted" style="font-size:14px;margin:0">הקישורים פותחים חיפוש, כדי להגיע תמיד לגרסה העדכנית של המקור.</p>'}</div>`);
    }
    const practiceHere = PRACTICE.filter((pr) => pr.after === lesson.id);
    if (practiceHere.length && !doc) {
      push('practice', '🏋️ תרגול נפתח', `${blockTitle('🏋️', 'נפתח תרגול חדש', 'אחרי השיעור הזה יש לך מספיק כלים לתכנן מערכת חדשה מאפס')}
        <div class="grid-2">${practiceHere.map(practiceCard).join('')}</div>`);
    }

    const done = state.work[lesson.id] || {};
    push('reflect', '💼 ובעבודה שלך?', `${blockTitle('💼', 'ובעבודה שלך?', 'מה שבאמת הופך ידע לניסיון: ליישם על המערכת שאת עובדת עליה')}
      <div class="card content">
      ${lesson.predict ? `<div class="callout">🤔 <b>חזרי לניחוש מתחילת השיעור.</b> מה היית משנה בו עכשיו? מה פספסת, ומה דווקא ידעת? <a href="#/lesson/${lesson.id}" data-jump="predict">לניחוש שלי ↑</a></div>` : ''}
      ${lesson.work ? `<h3>🔧 משימות בשטח השבוע</h3><p class="muted">לא חייבים הכל, וגם לא באותו יום. מספיקה אחת כדי שהשיעור ייתפס.</p>
        <ul class="work-list">${lesson.work.map((w, i) => `<li><label>${doc ? '☐' : `<input type="checkbox" data-work="${lesson.id}:${i}"${done[i] ? ' checked' : ''}>`}<span>${r(w)}</span></label></li>`).join('')}</ul>
        <h3>💭 ולחשוב</h3>` : ''}
      <p>${r(lesson.reflection)}</p>
      ${doc ? '' : `<textarea class="reflect" data-reflect="${lesson.id}" placeholder="מחשבות, תצפיות, שאלות לשאול בעבודה...">${esc(state.reflections[lesson.id] || '')}</textarea>`}</div>`);

    return { blocks, ctx };
  }

  function renderLesson(id) {
    const lesson = lessonById(id);
    if (!lesson) return renderNotFound();
    const w = weeks[lesson.week];
    const { blocks } = lessonBody(lesson);
    const prev = lessonById(lesson.id - 1);
    const next = lessonById(lesson.id + 1);
    const isDone = !!state.completed[lesson.id];

    main.innerHTML = `<div class="lesson-layout">
      <aside class="toc"><div class="card">
        <div class="muted" style="font-size:13px;font-weight:700;margin-bottom:6px">בשיעור הזה</div>
        ${blocks.map((b) => `<a href="#/lesson/${lesson.id}" data-jump="${b.id}">${b.tocTitle}</a>`).join('')}
        <a href="#/lesson/${lesson.id}" data-jump="finish">🏁 סיום</a>
        <div class="toc-actions">
          <button class="btn ghost small" data-act="download">⬇️ הורדת השיעור</button>
          <button class="btn ghost small" data-act="print">🖨️ הדפסה / PDF</button>
        </div>
      </div></aside>
      <article>
        <header class="lesson-head">
          <div class="kicker"><span class="chip ${w.color}">שבוע ${lesson.week} · ${w.title}</span><span class="chip">שיעור ${lesson.id} מתוך ${lessons.length}</span><span class="chip">⏱️ ${lesson.minutes} דקות</span>${isDone ? '<span class="chip w3">✓ הושלם</span>' : ''}</div>
          <h1>${lesson.icon} ${lesson.title}</h1>
          <div class="subtitle">${rich(lesson.subtitle)}</div>
          <div class="goals"><b>🎯 בסוף השיעור תדעי:</b><ul>${lesson.goals.map((g) => `<li>${rich(g)}</li>`).join('')}</ul></div>
          <div class="lesson-actions">
            <button class="btn ghost small" data-act="download">⬇️ הורדת השיעור כמסמך</button>
            <button class="btn ghost small" data-act="print">🖨️ הדפסה / PDF</button>
          </div>
        </header>
        ${blocks.map((b) => `<section class="block" id="b-${b.id}">${b.html}</section>`).join('')}
        <section class="block" id="b-finish">
          <div class="done-box">
            <div class="big">${isDone ? '🏅' : '🏁'}</div>
            <h2>${isDone ? 'השיעור הזה כבר מאחורייך' : 'הגעת לסוף השיעור!'}</h2>
            <p class="teaser">${lesson.teaser ? '🔮 בשיעור הבא: ' + rich(lesson.teaser) : ''}</p>
            <div class="row" style="justify-content:center">
              ${isDone ? '' : '<button class="btn accent" data-act="complete">✓ סיימתי את השיעור</button>'}
              ${next ? `<a class="btn ${isDone ? 'accent' : 'ghost'}" href="#/lesson/${next.id}">לשיעור ${next.id} ←</a>` : '<a class="btn ghost" href="#/">חזרה למפה</a>'}
            </div>
          </div>
          <div class="row" style="margin-top:18px">
            ${prev ? `<a class="btn ghost small" href="#/lesson/${prev.id}">→ שיעור ${prev.id}: ${esc(prev.title)}</a>` : ''}
            <span class="spacer"></span>
            <a class="btn ghost small" href="#/">🗺️ למפת המסע</a>
          </div>
        </section>
      </article>
    </div>`;

    initWidgets(main);
    setupScrollSpy();
  }

  function setupScrollSpy() {
    if (!('IntersectionObserver' in window)) return;
    const links = $$('.toc a[data-jump]');
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          const id = en.target.id.replace('b-', '');
          links.forEach((l) => l.classList.toggle('active', l.dataset.jump === id));
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    $$('.block').forEach((b) => obs.observe(b));
  }

  function completeLesson(id) {
    const lesson = lessonById(id);
    if (state.completed[id]) return;
    const prevLevel = level().name;
    state.completed[id] = new Date().toISOString();
    save();
    confetti();
    toast(level().name !== prevLevel ? `עלית רמה: ${level().name} 🎉` : `שיעור ${id} הושלם! ${doneCount()}/${lessons.length}`);
    renderLesson(lesson.id);
    location.hash = `#/lesson/${id}`;
    setTimeout(() => $('#b-finish').scrollIntoView({ block: 'center' }), 50);
  }

  // ---------- הורדת שיעור ----------
  let cssCache = null;
  async function downloadLesson(id) {
    const lesson = lessonById(id);
    const { blocks, ctx } = lessonBody(lesson, { doc: true });
    if (!cssCache) cssCache = await fetch('css/style.css').then((r) => r.text()).catch(() => '');
    const terms = [...ctx.terms].sort((a, b) => G[a].en.localeCompare(G[b].en));
    const glossaryHTML = terms.length ? `<section class="block">${blockTitle('📖', 'מונחים שהופיעו בשיעור', '')}
      <div class="gloss-list">${terms.map((k) => { const g = G[k]; return `<div class="gterm"><div class="g-head"><h3>${g.en}</h3><span class="g-he">${g.he}</span></div><div class="g-short">${g.short}</div><div class="g-long">${g.long}</div>${g.example ? `<div class="g-ex">${g.example}</div>` : ''}</div>`; }).join('')}</div></section>` : '';
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>שיעור ${lesson.id}: ${esc(lesson.title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Assistant:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
      <style>${cssCache}
      main{max-width:860px} .term-doc{border-bottom:2px dotted var(--primary)} .doc-foot{margin-top:40px;color:var(--muted);font-size:14px;text-align:center}</style></head>
      <body><main>
      <header class="lesson-head"><div class="kicker"><span class="chip ${weeks[lesson.week].color}">שבוע ${lesson.week} · ${weeks[lesson.week].title}</span><span class="chip">שיעור ${lesson.id} מתוך ${lessons.length}</span><span class="chip">⏱️ ${lesson.minutes} דקות</span></div>
      <h1>${lesson.icon} ${lesson.title}</h1><div class="subtitle">${rich(lesson.subtitle, ctx)}</div>
      <div class="goals"><b>🎯 בסוף השיעור תדעי:</b><ul>${lesson.goals.map((g) => `<li>${rich(g, ctx)}</li>`).join('')}</ul></div></header>
      ${blocks.map((b) => `<section class="block">${b.html}</section>`).join('')}
      ${glossaryHTML}
      ${state.exercises[lesson.id] ? `<section class="block">${blockTitle('📝', 'התכנון שלי', '')}<div class="card"><p style="white-space:pre-wrap">${esc(state.exercises[lesson.id])}</p></div></section>` : ''}
      <div class="doc-foot">מסע ל-System Design · שיעור ${lesson.id} · הורד ב-${new Date().toLocaleDateString('he-IL')}</div>
      </main></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `שיעור-${String(lesson.id).padStart(2, '0')}-${lesson.slug}.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('השיעור הורד כקובץ HTML. הוא נפתח בכל דפדפן, גם בלי אינטרנט');
  }

  // ---------- בית ----------
  function renderHome() {
    const nl = nextLesson();
    const st = quizStats();
    const lv = level();
    const pct = Math.round((doneCount() / lessons.length) * 100);
    const byWeek = {};
    lessons.forEach((l) => { (byWeek[l.week] = byWeek[l.week] || []).push(l); });

    main.innerHTML = `
      <section class="hero">
        <div>
          <span class="chip w2">קורס אישי · ${lessons.length} שיעורים · שיעור כל יומיים</span>
          <h1 style="margin-top:14px">מהמילים הלועזיות בישיבה<br>ל<span class="hl">הצעות ארכיטקטורה בביטחון</span></h1>
          <p class="lead">בכל שיעור, רבע עד חצי שעה: משבר אמיתי, הסבר יסודי עם אנלוגיות, סימולציה, תרגיל תכנון ובוחן שמחייב לחשוב. ולאורך כל הדרך בונים יחד מערכת אחת אמיתית: אפליקציית הצ'אט <b>שיחון</b>.</p>
          <div class="row">
            ${nl ? `<a class="btn accent" href="#/lesson/${nl.id}">${doneCount() ? 'להמשיך' : 'להתחיל'}: שיעור ${nl.id} ←</a>` : `<a class="btn accent" href="#/lesson/${lessons.length}">🏛️ סיימת! לחזור לשיעור האחרון</a>`}
            <a class="btn ghost" href="#/glossary">📖 למילון המושגים</a>
          </div>
        </div>
        <div class="hero-card">
          <div class="muted" style="font-size:14px;font-weight:700">הרמה שלך</div>
          <div class="level">${lv.name}</div>
          <div class="soft">${lv.desc}</div>
          <div class="stat-row">
            <div class="stat"><b>${doneCount()}/${lessons.length}</b><span>שיעורים</span></div>
            <div class="stat"><b>${st.total ? st.pct + '%' : '–'}</b><span>דיוק בבחנים</span></div>
            <div class="stat"><b>${activeMine().length}</b><span>במאגר שלי</span></div>
          </div>
          <div class="meter"><i style="width:${pct}%"></i></div>
          <div class="muted" style="font-size:13px;margin-top:6px">${pct}% מהמסע${lastActivityNote()}</div>
        </div>
      </section>

      <section class="story-box">
        <span class="emoji">💬</span>
        <div><h3 style="margin-bottom:4px">הסיפור: את מהנדסת ראשונה בסטארט-אפ "שיחון"</h3>
        <p style="margin:0" class="soft">שיחון היא אפליקציית צ'אט שמתחילה עם 100 משתמשים חברים ונעשית ויראלית. בכל שיעור היא נתקלת במשבר חדש: קריסה, איטיות, הודעות שנעלמות. והמושג החדש הוא מה שמציל אותה. בסוף הקורס תהיה לך ארכיטקטורה מלאה שבנית בעצמך, ומילים לכל החלטה.</p></div>
      </section>

      ${Object.keys(byWeek).map((wk) => { const w = weeks[wk]; return `<section class="week">
        <div class="week-head"><span class="chip ${w.color}">שבוע ${wk}</span><h2>${w.title}</h2><span class="muted">${w.sub}</span></div>
        <div class="line">${byWeek[wk].map((l) => {
          const done = state.completed[l.id];
          const current = nl && nl.id === l.id;
          return `<a class="station ${done ? 'done' : ''} ${current ? 'current' : ''}" style="--wc:var(--${w.color})" href="#/lesson/${l.id}">
            <span class="icon">${l.icon}</span><span class="num">${done ? '✓' : l.id}</span>
            <h3>${l.title}</h3><span class="sub">${l.subtitle.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (m, k, t) => t || (G[k] ? G[k].en : k))}</span>
            <span class="meta">⏱️ ${l.minutes} דק'${l.review ? ' · 🎯 Design Review' : ''}${current ? ' · <b style="color:var(--wc)">הבא בתור</b>' : ''}</span></a>`;
        }).join('')}</div></section>`; }).join('')}

      <section class="week">
        <div class="week-head"><h2>🧰 מעבר לשיעורים</h2><span class="muted">לתרגל, לזהות, ולשלוף מהר</span></div>
        <div class="grid-3">
          <a class="card tool-card" href="#/practice"><span class="t-ico">🏋️</span><b>תרגול תכנון</b><span class="soft">${PRACTICE.length} מערכות חדשות מאפס, צעד אחרי צעד, עם "מה מצופה בכל רמה". ${practiceDone()}/${PRACTICE.length} הושלמו</span></a>
          <a class="card tool-card" href="#/patterns"><span class="t-ico">🧩</span><b>תבניות חוזרות</b><span class="soft">${PATTERNS.length} בעיות שמופיעות כמעט בכל מערכת, והפתרונות המקובלים. עם בוחן זיהוי</span></a>
          <a class="card tool-card" href="#/cheatsheet"><span class="t-ico">📋</span><b>דף שליפה</b><span class="soft">ברירות מחדל בטוחות, טעויות נפוצות, והשאלות ששואלים בכל דיון</span></a>
        </div>
      </section>

      <section class="week">
        <div class="week-head"><h2>🏅 תגים</h2><span class="muted">נפתחים לאורך הדרך</span></div>
        <div class="badges">${badges().map((b) => `<div class="badge ${b.got ? '' : 'locked'}" title="${esc(b.how)}"><span class="b-ico">${b.icon}</span><div><b>${b.name}</b><div class="muted" style="font-size:13px">${b.how}</div></div></div>`).join('')}</div>
      </section>

      <section class="week">
        <div class="week-head"><h2>🧩 איך בנוי כל שיעור</h2></div>
        <div class="grid-3">
          ${[['☕', 'חימום', 'שאלות חזרה. מה שהיה קשה חוזר יותר'], ['🚨', 'משבר', 'משהו נשבר בשיחון, וצריך להבין למה'], ['🧠', 'הסבר יסודי', 'אנלוגיות, תרשימים, וחיבור לעולם Java/React'], ['🎛️', 'סימולציה', 'משחקים עם המספרים ורואים מה קורה'], ['🗣️', 'לדבר כמו ארכיטקטית', 'משפטים לישיבות'], ['✏️', 'תרגיל + בוחן', 'עם רמזים, תשובות והסבר לכל אפשרות']]
            .map(([i, t, d]) => `<div class="card" style="padding:16px 18px"><div style="font-size:26px">${i}</div><b>${t}</b><div class="soft" style="font-size:15px">${d}</div></div>`).join('')}
        </div>
      </section>`;
  }

  function lastActivityNote() {
    const last = [...state.visits].sort().pop();
    if (!last) return '';
    const days = Math.round((new Date(new Date().toISOString().slice(0, 10)) - new Date(last)) / 86400000);
    return days <= 0 ? ' · היית כאן היום 👏' : ` · ביקור אחרון לפני ${days} ימים`;
  }

  function badges() {
    const weekDone = (w) => lessons.filter((l) => l.week === w).every((l) => state.completed[l.id]);
    const sureRight = Object.values(state.quiz).filter((r) => r.ok && r.conf === 'sure').length;
    const dates = Object.values(state.completed).map((d) => new Date(d).getTime()).sort((a, b) => a - b);
    let run = dates.length ? 1 : 0; let best = run;
    for (let i = 1; i < dates.length; i++) { run = dates[i] - dates[i - 1] <= 3.5 * 86400000 ? run + 1 : 1; best = Math.max(best, run); }
    return [
      { icon: '👣', name: 'צעד ראשון', how: 'לסיים שיעור ראשון', got: doneCount() >= 1 },
      { icon: '🧱', name: 'יסודות חזקים', how: 'לסיים את שבוע 1', got: weekDone(1) },
      { icon: '🗄️', name: 'מאלפת נתונים', how: 'לסיים את שבוע 2', got: weekDone(2) },
      { icon: '📡', name: 'מתקשרת', how: 'לסיים את שבוע 3', got: weekDone(3) },
      { icon: '🔥', name: 'בקצב', how: '4 שיעורים ברצף, עד 3 ימים בין שיעור לשיעור', got: best >= 4 },
      { icon: '🎯', name: 'צלפית', how: '20 תשובות נכונות שסימנת "בטוחה"', got: sureRight >= 20 },
      { icon: '🏋️', name: 'מתרגלת', how: 'לסיים 3 תרגילי תכנון בדף התרגול', got: practiceDone() >= 3 },
      { icon: '🧩', name: 'מזהה תבניות', how: '6 תשובות נכונות בבוחן זיהוי התבניות', got: PQUIZ.filter((q) => state.quiz[q.id] && state.quiz[q.id].ok).length >= 6 },
      { icon: '🔍', name: 'סקרנית', how: '5 פריטים במאגר האישי', got: activeMine().length >= 5 },
      { icon: '🏛️', name: 'ארכיטקטית', how: `לסיים את כל ${lessons.length} השיעורים`, got: doneCount() === lessons.length },
    ];
  }

  // ---------- מילון ----------
  function renderGlossary(focusKey) {
    const keys = Object.keys(G).sort((a, b) => G[a].en.localeCompare(G[b].en, 'en', { sensitivity: 'base' }));
    const letters = [...new Set(keys.map((k) => G[k].en[0].toUpperCase()))];
    main.innerHTML = `
      <h1>📖 מילון המושגים</h1>
      <p class="lead soft">כל ${keys.length} המושגים מכל השיעורים, עם הסבר קצר, הסבר מורחב ודוגמה משיחון. ליד כל מושג יש קישור לשיעור שבו לומדים אותו.</p>
      <div class="gloss-tools">
        <div class="search"><input type="search" id="gSearch" placeholder="🔍 חיפוש בעברית או באנגלית..." autocomplete="off"></div>
        <div class="field" style="margin:0;min-width:200px"><select id="gLesson"><option value="">כל השיעורים</option>${lessons.map((l) => `<option value="${l.id}">${l.id}. ${esc(l.title)}</option>`).join('')}</select></div>
      </div>
      <div class="letters">${letters.map((c) => `<a href="#/glossary" data-letter="${c}">${c}</a>`).join('')}</div>
      <div class="gloss-list" id="gList">${keys.map((k) => glossItem(k)).join('')}</div>
      <div class="empty" id="gEmpty" hidden>לא נמצא מושג כזה. אפשר להוסיף אותו למאגר האישי ולשאול עליו את קלוד ⭐</div>`;

    const filter = () => {
      const q = $('#gSearch').value.trim().toLowerCase();
      const ls = $('#gLesson').value;
      let shown = 0;
      $$('.gterm').forEach((el) => {
        const g = G[el.dataset.key];
        const hit = (!q || (g.en + ' ' + g.he + ' ' + g.short + ' ' + (g.aka || '')).toLowerCase().includes(q)) && (!ls || String(g.lesson) === ls);
        el.hidden = !hit;
        if (hit) shown++;
      });
      $('#gEmpty').hidden = shown > 0;
    };
    $('#gSearch').addEventListener('input', filter);
    $('#gLesson').addEventListener('change', filter);

    if (focusKey && G[focusKey]) {
      const el = $(`#g-${focusKey}`);
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 2200);
      });
    }
  }

  function glossItem(k) {
    const g = G[k];
    const l = lessonById(g.lesson);
    return `<article class="gterm" id="g-${k}" data-key="${k}">
      <div class="g-head"><h3>${g.en}</h3><span class="g-he">${g.he}</span><span class="spacer"></span>${l ? `<a class="chip ${weeks[l.week].color}" href="#/lesson/${l.id}" style="text-decoration:none">שיעור ${l.id}: ${esc(l.title)}</a>` : ''}</div>
      <div class="g-short">${g.short}</div>
      <div class="g-long">${rich(g.long)}</div>
      ${g.example ? `<div class="g-ex">${rich(g.example)}</div>` : ''}
      <div class="g-foot">
        ${(g.related || []).filter((r) => G[r]).map((r) => `<a class="rel" href="#/glossary/${r}">${G[r].en}</a>`).join('')}
        <span class="spacer"></span>
        <button class="btn ghost tiny" data-add-term="${k}">⭐ למאגר שלי</button>
      </div>
    </article>`;
  }

  // ---------- המאגר שלי ----------
  function renderMine() {
    const items = activeMine().sort((a, b) => (a.understood - b.understood) || (b.createdAt - a.createdAt));
    const weak = weakQuestions();
    main.innerHTML = `
      <h1>⭐ המאגר שלי</h1>
      <p class="lead soft">כל מה שסימנת כלא ברור: מילים מהשיעורים (מסמנים טקסט ולוחצים "➕ הוספה למאגר"), מושגים מהמילון, ושאלות שהיו קשות. בסוף יוצרים מכל זה פרומפט אחד מסודר לקלוד.</p>
      <div class="grid-2" style="align-items:start">
        <section>
          <div class="row" style="margin-bottom:12px"><h2 style="margin:0">מושגים ושאלות (${items.length})</h2><span class="spacer"></span><button class="btn small" data-act="new-mine">➕ הוספה ידנית</button></div>
          <div class="mine">${items.length ? items.map(mineItem).join('') : '<div class="card empty">עדיין ריק. בזמן קריאת שיעור, מסמנים מילה או משפט עם העכבר ולוחצים על "➕ הוספה למאגר שלי".</div>'}</div>
          <h2 style="margin-top:28px">🔁 שאלות לחזור אליהן (${weak.length})</h2>
          <div class="mine">${weak.length ? weak.map((id) => { const { q, lesson } = QINDEX[id]; const r = state.quiz[id]; return `<div class="mine-item"><div class="mi-text">${rich(q.q)}</div><div class="mi-meta"><span class="chip">${r.conf === 'guess' ? 'ניחשת' : r.conf === 'revealed' ? 'הצגת תשובה' : 'טעות'}</span><a href="#/lesson/${lesson.id}">שיעור ${lesson.id}: ${esc(lesson.title)}</a></div></div>`; }).join('') : '<div class="card empty">אין שאלות פתוחות. כל הכבוד! 💪</div>'}</div>
        </section>
        <section class="card prompt-box" style="position:sticky;top:84px">
          <h2>✨ יצירת פרומפט לקלוד</h2>
          <p class="soft" style="font-size:16px">הפרומפט כולל את הרקע שלך, את ההתקדמות, ואת כל הפריטים שבחרת. מעתיקים ומדביקים בקלוד, מכל מחשב.</p>
          <label class="check"><input type="checkbox" id="pMine" checked> מושגים ושאלות שעוד לא הבנתי</label>
          <label class="check"><input type="checkbox" id="pWeak" checked> שאלות מבחנים שהיו קשות</label>
          <label class="check"><input type="checkbox" id="pQuiz"> לבקש מקלוד שיבחן אותי אחרי ההסבר</label>
          <div class="row" style="margin:14px 0 10px"><button class="btn accent" data-act="gen-prompt">יצירת פרומפט</button><button class="btn ghost" data-act="copy-prompt">📋 העתקה</button></div>
          <textarea id="promptOut" readonly placeholder="לוחצים על 'יצירת פרומפט'..."></textarea>
        </section>
      </div>`;
  }

  function mineItem(m) {
    const l = lessonById(m.lessonId);
    const gk = m.termKey && G[m.termKey];
    return `<div class="mine-item ${m.understood ? 'understood' : ''}" data-mine="${m.id}">
      <div class="mi-text">${esc(m.text)}</div>
      ${m.question ? `<div class="mi-q">❓ ${esc(m.question)}</div>` : ''}
      <div class="mi-meta">
        ${l ? `<a href="#/lesson/${l.id}">שיעור ${l.id}</a>` : ''}
        ${gk ? `<a href="#/glossary/${m.termKey}">במילון</a>` : ''}
        <span>${new Date(m.createdAt).toLocaleDateString('he-IL')}</span>
        <span class="spacer"></span>
        <button class="btn ghost tiny" data-mine-act="toggle">${m.understood ? '↺ עוד לא' : '✓ הבנתי'}</button>
        <button class="btn ghost tiny" data-mine-act="edit">✎</button>
        <button class="btn ghost tiny" data-mine-act="delete">🗑</button>
      </div></div>`;
  }

  const PROFILE = 'אני מפתחת Full Stack (Java + Spring בצד השרת, React בצד הלקוח). אני עובדת במערכת גדולה שבה הרבה החלטות תשתית וארכיטקטורה כבר התקבלו בשבילי, ועכשיו אני לומדת System Design וארכיטקטורה מהיסוד בקורס אישי, כדי להבין מושגים ולהציע ארכיטקטורות נכונות בדיונים בעבודה. בקורס בונים לאורך כל הדרך אפליקציית צ\'אט בשם "שיחון".';

  function buildPrompt({ mine, weak, quizMe }) {
    const lines = [`היי Claude! ${PROFILE}`];
    const last = lessons.filter((l) => state.completed[l.id]).pop();
    lines.push(`התקדמות: סיימתי ${doneCount()} מתוך ${lessons.length} שיעורים${last ? ` (האחרון: "${last.title}")` : ''}.`);
    const open = activeMine().filter((m) => !m.understood);
    if (mine && open.length) {
      lines.push('', 'אלה מושגים ושאלות שעדיין לא ברורים לי:');
      open.forEach((m, i) => {
        const l = lessonById(m.lessonId);
        lines.push(`${i + 1}. "${m.text}"${l ? ` (מתוך שיעור ${l.id}: ${l.title})` : ''}${m.question ? `\n   השאלה שלי: ${m.question}` : ''}`);
      });
    }
    const wq = weakQuestions();
    if (weak && wq.length) {
      lines.push('', 'שאלות מבחנים שטעיתי בהן או ניחשתי. אני רוצה להבין את ההיגיון ולא רק לזכור תשובה:');
      wq.forEach((id, i) => {
        const { q } = QINDEX[id];
        lines.push(`${i + 1}. ${plain(q.q)}\n   התשובה הנכונה: ${plain(q.options[q.answer])}`);
      });
    }
    if (lines.length <= 2) lines.push('', 'אין לי כרגע פריטים פתוחים. תוכל לשאול אותי 5 שאלות תרחיש על מה שלמדתי עד עכשיו?');
    lines.push('', 'בבקשה, לכל פריט:', '- הסבר יסודי וברור, צעד אחרי צעד, בלי להניח ידע מוקדם', '- אנלוגיה מהחיים', '- דוגמה מאפליקציית צ\'אט', '- איך זה נראה בעולם Java/Spring או בכלים מוכרים (אם רלוונטי)', '- טעות נפוצה אחת או trade-off חשוב', '- משפט אחד שאפשר להגיד בישיבת דיזיין');
    if (quizMe) lines.push('', 'בסוף, תבחן אותי: 3 שאלות אמריקאיות שמחייבות הבנה ולא שינון. אל תגלה את התשובות עד שאענה.');
    return lines.join('\n');
  }

  function questionPrompt(q, lesson) {
    return [`היי Claude! ${PROFILE}`, '', `בשיעור "${lesson.title}" נתקלתי בשאלה הזו:`, plain(q.q), '',
      ...q.options.map((o, i) => `${LETTERS[i]}. ${plain(o)}`), '', `התשובה הנכונה היא ${LETTERS[q.answer]}.`,
      'תסביר לי לעומק למה, ולמה כל אחת מהאפשרויות האחרות פחות טובה. תן אנלוגיה מהחיים ודוגמה מאפליקציית צ\'אט, ואז שאלת המשך אחת שבודקת שהבנתי.'].join('\n');
  }

  const plain = (html) => String(html).replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (m, k, t) => t || (G[k] ? G[k].en : k)).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

  function openMineModal({ text = '', question = '', lessonId = null, termKey = null, edit = null } = {}) {
    const m = edit ? state.mine.find((x) => x.id === edit) : null;
    $('#modalRoot').innerHTML = `<div class="modal-back" data-close><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h3 id="mTitle">${m ? '✎ עריכה' : '⭐ הוספה למאגר שלי'}</h3>
      <div class="field"><label for="mText">מושג או משפט</label><input id="mText" maxlength="300" value="${esc(m ? m.text : text)}"></div>
      <div class="field"><label for="mQ">מה לא ברור? (לא חובה)</label><textarea id="mQ" rows="3" maxlength="1000" placeholder="למשל: מה ההבדל בין זה לבין Replication?">${esc(m ? m.question : question)}</textarea>
      <span class="help">השאלה תיכנס לפרומפט לקלוד</span></div>
      <div class="row"><button class="btn" data-act="save-mine">שמירה</button><button class="btn ghost" data-close>ביטול</button></div>
    </div></div>`;
    const back = $('.modal-back');
    back.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeModal(); });
    $('[data-act="save-mine"]', back).addEventListener('click', () => {
      const t = $('#mText').value.trim();
      if (!t) { toast('צריך לכתוב מושג'); return; }
      const q = $('#mQ').value.trim();
      if (m) Object.assign(m, { text: t, question: q, updatedAt: Date.now() });
      else state.mine.push({ id: uid(), text: t, question: q, lessonId, termKey, createdAt: Date.now(), updatedAt: Date.now(), understood: false });
      save();
      closeModal();
      toast(m ? 'עודכן ✓' : 'נוסף למאגר ⭐');
      if (currentRoute()[0] === 'my') renderMine();
    });
    setTimeout(() => $(m || !text ? '#mText' : '#mQ').focus(), 30);
  }
  const closeModal = () => { $('#modalRoot').innerHTML = ''; };

  // ---------- הגדרות ----------
  function renderSettings() {
    main.innerHTML = `
      <h1>⚙️ הגדרות</h1>
      <div class="grid-2" style="align-items:start">
        <section class="card">
          <h2>🔐 כניסה</h2>
          <p class="soft"><span class="status-dot ${Sync.online ? 'on' : 'off'}"></span>${Sync.online ? 'את מחוברת. ההתקדמות והמאגר מסונכרנים לענן, ויהיו זמינים בכל מחשב שתיכנסי ממנו עם הקוד.' : 'אין כרגע חיבור לשרת. כל מה שתעשי נשמר בדפדפן, ויסונכרן בפעם הבאה.'}</p>
          <p class="soft" style="font-size:15px">במחשב משותף, כדאי להתנתק בסוף. כדי להחליף את קוד הכניסה מריצים במחשב שבו הותקן האתר: <code>npm run change-code</code>. ההחלפה מנתקת את כל הדפדפנים.</p>
          <a class="btn ghost" href="/logout">🚪 התנתקות</a>
        </section>

        <section class="card" id="remCard">
          <h2>📬 תזכורות במייל</h2>
          <p class="muted">טוען הגדרות...</p>
        </section>

        <section class="card">
          <h2>💾 גיבוי</h2>
          <p class="soft">גיבוי של כל ההתקדמות, התשובות והמאגר לקובץ במחשב. שימושי גם בלי חיבור לענן.</p>
          <div class="row"><button class="btn ghost" data-act="export">⬇️ ייצוא לקובץ</button>
          <label class="btn ghost" style="cursor:pointer">⬆️ ייבוא מקובץ<input type="file" id="importFile" accept="application/json" hidden></label></div>
          <hr><button class="btn ghost small" data-act="reset" style="color:var(--red)">איפוס כל ההתקדמות</button>
        </section>

        <section class="card">
          <h2>🎨 מראה</h2>
          <div class="seg" id="themeSeg">${[['auto', 'לפי המערכת'], ['light', '☀️ בהיר'], ['dark', '🌙 כהה']].map(([v, t]) => `<button data-theme-set="${v}" class="${(safeGet(THEME_KEY) || 'auto') === v ? 'on' : ''}">${t}</button>`).join('')}</div>
        </section>
      </div>`;

    $('#importFile').addEventListener('change', importBackup);
    loadReminderSettings();
  }

  async function loadReminderSettings() {
    const card = $('#remCard');
    try {
      const { settings: s, meta, mailConfigured } = await Sync.api('/settings');
      const days = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
      card.innerHTML = `<h2>📬 תזכורות במייל</h2>
        ${mailConfigured ? '' : '<div class="warn" style="margin-bottom:14px"><p>שירות המייל עדיין לא מוגדר בשרת (חסר RESEND_API_KEY). ההגדרות יישמרו, אבל מיילים יתחילו לצאת רק אחרי ההגדרה. ההסבר נמצא ב-README.</p></div>'}
        <label class="check" style="margin-bottom:14px"><input type="checkbox" id="rEnabled" ${s.enabled ? 'checked' : ''}> <b>לשלוח לי תזכורות</b></label>
        <div class="field"><label for="rEmail">כתובת מייל</label><input id="rEmail" type="email" value="${esc(s.email)}" placeholder="name@example.com" dir="ltr"></div>
        <div class="field"><label>מתי?</label>
          <div class="seg" id="rMode"><button data-mode="interval" class="${s.mode === 'interval' ? 'on' : ''}">כל כמה ימים</button><button data-mode="weekdays" class="${s.mode === 'weekdays' ? 'on' : ''}">בימים קבועים</button></div></div>
        <div class="field" id="rIntervalBox" ${s.mode === 'interval' ? '' : 'hidden'}><label for="rEvery">כל</label>
          <select id="rEvery">${[1, 2, 3, 4, 5, 7].map((n) => `<option value="${n}" ${s.everyDays === n ? 'selected' : ''}>${n === 1 ? 'יום' : n + ' ימים'}</option>`).join('')}</select></div>
        <div class="field" id="rDaysBox" ${s.mode === 'weekdays' ? '' : 'hidden'}><label>בימים</label>
          <div class="days">${days.map((d, i) => `<label><input type="checkbox" value="${i}" ${s.weekdays.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div></div>
        <div class="field"><label for="rHour">בשעה (שעון ישראל)</label>
          <select id="rHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${s.hour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
        <div class="field"><label for="rInactive">"התגעגענו" אם לא נכנסתי</label>
          <select id="rInactive">${[0, 2, 3, 4, 5, 7].map((n) => `<option value="${n}" ${s.inactiveDays === n ? 'selected' : ''}>${n === 0 ? 'לא לשלוח' : `אחרי ${n} ימים בלי כניסה`}</option>`).join('')}</select>
          <span class="help">המייל מציין כמה ימים עברו מאז הביקור האחרון ומה השיעור הבא</span></div>
        <label class="check" style="margin-bottom:16px"><input type="checkbox" id="rSkip" ${s.skipIfVisitedToday ? 'checked' : ''}> לא לשלוח תזכורת אם כבר נכנסתי באותו יום</label>
        <div class="row"><button class="btn" data-act="save-rem">שמירה</button><button class="btn ghost" data-act="test-mail">📨 שליחת מייל בדיקה</button></div>
        <p class="muted" style="font-size:14px;margin-top:14px">ביקור אחרון שנרשם: ${meta.lastVisit ? new Date(meta.lastVisit).toLocaleString('he-IL') : '—'}<br>מייל אחרון שנשלח: ${meta.lastSent ? new Date(meta.lastSent).toLocaleString('he-IL') + (meta.lastSentKind === 'nudge' ? ' (התגעגענו)' : '') : '—'}</p>`;
      $('#rMode').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]'); if (!b) return;
        $$('#rMode button').forEach((x) => x.classList.toggle('on', x === b));
        $('#rIntervalBox').hidden = b.dataset.mode !== 'interval';
        $('#rDaysBox').hidden = b.dataset.mode !== 'weekdays';
      });
    } catch (e) {
      card.innerHTML = '<h2>📬 תזכורות במייל</h2><p class="soft">אין חיבור לשרת כרגע. נסי לרענן בעוד רגע.</p>';
    }
  }

  async function saveReminders() {
    const body = {
      enabled: $('#rEnabled').checked,
      email: $('#rEmail').value.trim(),
      mode: $('#rMode .on').dataset.mode,
      everyDays: Number($('#rEvery').value),
      weekdays: $$('#rDaysBox input:checked').map((i) => Number(i.value)),
      hour: Number($('#rHour').value),
      inactiveDays: Number($('#rInactive').value),
      skipIfVisitedToday: $('#rSkip').checked,
    };
    if (body.enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) { toast('כתובת המייל לא נראית תקינה'); return; }
    if (body.mode === 'weekdays' && !body.weekdays.length) { toast('בחרי לפחות יום אחד'); return; }
    try { await Sync.api('/settings', { method: 'PUT', body: JSON.stringify(body) }); toast('ההגדרות נשמרו ✓'); } catch { toast('השמירה נכשלה'); }
  }

  function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => {
      const data = JSON.parse(t);
      if (!data || typeof data !== 'object' || !data.completed) throw new Error('bad');
      state = merge(state, data);
      save();
      toast('הגיבוי יובא ומוזג ✓');
      render();
    }).catch(() => toast('הקובץ לא תקין'));
  }

  // ---------- תרגול ----------
  const practiceDone = () => PRACTICE.filter((pr) => (state.practice[pr.id] || {}).done).length;
  const LEVEL_NAMES = { mid: '🌿 Mid-level', senior: '🌳 Senior', staff: '🏔️ Staff' };

  function practiceCard(pr) {
    const st = state.practice[pr.id] || {};
    const started = Object.values(st.answers || {}).some((v) => v && v.trim());
    const ready = !!state.completed[pr.after];
    return `<a class="card tool-card practice-card ${st.done ? 'done' : ''}" href="#/practice/${pr.id}">
      <span class="t-ico">${pr.icon}</span>
      <b>${esc(pr.title)}</b>
      <span class="row" style="gap:6px"><span class="chip">${pr.level}</span><span class="chip">⏱️ ${pr.minutes} דק'</span>${st.done ? '<span class="chip w3">✓ הושלם</span>' : started ? '<span class="chip w4">בתהליך</span>' : ''}</span>
      <span class="soft">${pr.brief.replace(/<[^>]+>/g, '').slice(0, 110)}...</span>
      <span class="muted" style="font-size:13px">${ready ? '✓ ' : ''}מומלץ אחרי שיעור ${pr.after}</span></a>`;
  }

  function renderPracticeList() {
    main.innerHTML = `<div class="page-narrow">
      <h1>🏋️ תרגול תכנון</h1>
      <p class="lead soft">בשיעורים בנית את שיחון. כאן בודקים שהשיטה עובדת גם על מערכות אחרות. בכל תרגיל, חמישה צעדים: דרישות, הערכה גסה, API ונתונים, ארכיטקטורה, ו"מה קורה כש...". כותבים תשובה, ורק אז פותחים את הפתרון.</p>
      <div class="callout"><p>💡 <b>הכי חשוב:</b> לכתוב לפני שמציצים, גם תשובה חלקית. ההשוואה בין מה שכתבת לפתרון היא בדיוק המקום שבו לומדים. ובסוף כל תרגיל אפשר ליצור פרומפט שמבקש מ-Claude לבקר את התשובות שלך כמו ארכיטקט בכיר.</p></div>
      <div class="grid-2" style="margin-top:20px">${PRACTICE.map(practiceCard).join('')}</div></div>`;
  }

  function renderProblem(id) {
    const pr = PRACTICE.find((x) => x.id === id);
    if (!pr) return renderNotFound();
    const st = state.practice[pr.id] || {};
    const ans = st.answers || {};
    const pats = pr.patterns.map((pid) => PATTERNS.find((x) => x.id === pid)).filter(Boolean);
    main.innerHTML = `<div class="page-narrow">
      <a href="#/practice" class="muted" style="text-decoration:none">→ כל התרגילים</a>
      <h1 style="margin-top:8px">${pr.icon} ${esc(pr.title)}</h1>
      <div class="row" style="gap:6px;margin-bottom:14px"><span class="chip">${pr.level}</span><span class="chip">⏱️ ${pr.minutes} דק'</span><span class="chip">מומלץ אחרי שיעור ${pr.after}</span>${st.done ? '<span class="chip w3">✓ הושלם</span>' : ''}</div>
      <div class="crisis"><h2>המשימה</h2>${rich(pr.brief)}</div>
      ${pr.steps.map((s, i) => `<section class="block">
        ${blockTitle(['📋', '🧮', '🔌', '🏗️', '💥'][i] || '✏️', `צעד ${i + 1}: ${s.title}`, '')}
        <div class="card exercise content"><p>${rich(s.ask)}</p>
          <textarea data-pr="${pr.id}:${i}" placeholder="התשובה שלך. נשמרת אוטומטית.">${esc(ans[i] || '')}</textarea>
          ${s.hint ? `<details class="reveal"><summary>רמז</summary><div>${rich(s.hint)}</div></details>` : ''}
          <details class="reveal solution"><summary>✅ פתרון לדוגמה</summary><div>${rich(s.solution)}</div></details>
        </div></section>`).join('')}
      <section class="block">
        ${blockTitle('🎚️', 'מה מצופה בכל רמה', 'אותה שאלה, עומק אחר. איפה התשובות שלך נמצאות?')}
        <div class="levels">${Object.entries(pr.levels).map(([k, v]) => `<div class="card"><b>${LEVEL_NAMES[k]}</b><p class="soft" style="margin:6px 0 0">${rich(v)}</p></div>`).join('')}</div>
      </section>
      <section class="block">
        ${blockTitle('⚠️', 'טעויות נפוצות בתרגיל הזה', '')}
        <div class="card content"><ul>${pr.mistakes.map((m) => `<li>${rich(m)}</li>`).join('')}</ul>
        <p class="muted" style="margin:0">התבניות בתרגיל: ${pats.map((x) => `<a href="#/patterns/${x.id}">${x.icon} ${x.title}</a>`).join(' · ')}</p></div>
      </section>
      <div class="done-box">
        <div class="big">${st.done ? '🏅' : '🏁'}</div>
        <h2>${st.done ? 'התרגיל הזה הושלם' : 'סיימת לעבור על כל הצעדים?'}</h2>
        <p class="soft">רוצה ביקורת אמיתית? הפרומפט כולל את כל מה שכתבת, ומבקש מ-Claude לבחון אותך כמו ארכיטקט בכיר: מה חזק, מה חסר, ושאלת המשך קשה.</p>
        <div class="row" style="justify-content:center">
          <button class="btn ghost" data-act="practice-prompt" data-arg="${pr.id}">✨ פרומפט לביקורת על התשובות שלי</button>
          ${st.done ? '' : `<button class="btn accent" data-act="practice-done" data-arg="${pr.id}">✓ סימון כהושלם</button>`}
        </div>
      </div></div>`;
  }

  function practicePrompt(pr) {
    const ans = (state.practice[pr.id] || {}).answers || {};
    return [`היי Claude! ${PROFILE}`, '', `אני מתרגלת תכנון מערכת: "${pr.title}".`, plain(pr.brief).trim(), '',
      ...pr.steps.flatMap((s, i) => [`### צעד ${i + 1}: ${s.title}`, `השאלה: ${plain(s.ask)}`, `התשובה שלי: ${(ans[i] || '').trim() || '(לא עניתי)'}`, '']),
      'תבחן את התשובות שלי כמו ארכיטקט בכיר בישיבת Design Review:',
      '1. מה חזק בתשובות שלי?',
      '2. מה חסר או שגוי, לפי סדר חשיבות? תסביר למה זה חשוב.',
      '3. לאיזו רמה (Mid, Senior, Staff) התשובות שלי מתאימות, ומה היה מקפיץ אותן רמה?',
      '4. תשאל אותי שאלת המשך קשה אחת, ותחכה לתשובה שלי לפני שאתה ממשיך.',
      'תכתוב בעברית, ותפנה אליי בלשון נקבה.'].join('\n');
  }

  // ---------- תבניות ----------
  function renderPatterns() {
    main.innerHTML = `<div class="page-narrow">
      <h1>🧩 תבניות חוזרות</h1>
      <p class="lead soft">רוב בעיות התכנון הן וריאציות של כמה בעיות קבועות. ארכיטקטים מנוסים לא ממציאים כל פעם מחדש: הם <b>מזהים את התבנית</b>, ושולפים את הפתרונות המקובלים עם המחיר של כל אחד. לכל תבנית: איך מזהים אותה, מה עושים, ומה המלכודת.</p>
      <div class="pattern-index">${PATTERNS.map((pt) => `<a href="#/patterns/${pt.id}">${pt.icon} ${pt.title}</a>`).join('')}<a href="#/cheatsheet">📋 דף שליפה</a></div>
      ${PATTERNS.map((pt) => `<section class="block pattern" id="p-${pt.id}">
        ${blockTitle(pt.icon, pt.title, rich(pt.gist))}
        <div class="card content">
          <h3>🔎 איך מזהים</h3><ul>${pt.signals.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>
          <h3>🧰 מה עושים</h3>
          ${table({ head: ['כלי', 'מתי', 'המחיר'], rows: pt.moves })}
          <div class="warn"><p><b>המלכודת:</b> ${rich(pt.pitfall)}</p></div>
          <p class="soft" style="margin:0">${rich(pt.example)} · <b>שיעורים:</b> ${pt.lessons.map((id) => { const l = lessonById(id); return `<a href="#/lesson/${id}">${id}. ${esc(l.title)}</a>`; }).join(', ')}</p>
        </div></section>`).join('')}
      <section class="block" id="p-quiz">
        ${blockTitle('🎯', 'בוחן זיהוי', `${PQUIZ.length} תרחישים ממערכות אחרות. איזו תבנית מסתתרת בכל אחד?`)}
        <div class="quiz">${PQUIZ.map((q, i) => questionHTML(q, i + 1)).join('')}</div>
        <div class="score-box" hidden></div>
      </section></div>`;
  }

  // ---------- דף שליפה ----------
  function renderCheatsheet() {
    if (!CHEAT) return renderNotFound();
    const L = (id) => `<a href="#/lesson/${id}" class="muted">שיעור ${id}</a>`;
    main.innerHTML = `<div class="page-narrow cheatsheet">
      <div class="row" style="justify-content:space-between;align-items:center"><h1>📋 דף שליפה</h1><button class="btn ghost small no-print" data-act="print">🖨️ הדפסה / PDF</button></div>
      <p class="lead soft">לפני ישיבת דיזיין, או כשמשהו לא מסתדר. כל שורה מפנה לשיעור שבו היא מוסברת.</p>
      <section class="block">${blockTitle('✅', 'ברירות מחדל בטוחות', 'מתחילים מכאן, וסוטים רק כשיש סיבה מדודה')}
        ${table({ head: ['נושא', 'ברירת מחדל', 'מתי לסטות', ''], rows: CHEAT.defaults.map(([a, b, c, id]) => [a, `<b>${b}</b>`, c, L(id)]) })}</section>
      <section class="block">${blockTitle('⚠️', 'טעויות נפוצות', 'ומה עושים במקום')}
        ${table({ head: ['הטעות', 'במקום', ''], rows: CHEAT.mistakes.map(([a, b, id]) => [a, b, L(id)]) })}</section>
      <section class="block">${blockTitle('❓', 'שאלות ששואלים בכל דיון', 'אם תזכרי רק דבר אחד מהקורס, שיהיה זה')}
        <div class="card content"><ol class="steps">${CHEAT.questions.map((q) => `<li>${rich(q)}</li>`).join('')}</ol></div></section>
      <p class="soft">ולמספרים שכדאי לזכור (זמני גישה, רוחב פס, סדרי גודל): <a href="#/lesson/2">שיעור 2</a>.</p></div>`;
  }

  // ---------- אודות ----------
  function renderAbout() {
    main.innerHTML = `<div class="card content" style="max-width:820px;margin:0 auto">
      <h1>על הקורס</h1>
      <p>הקורס בנוי ל-${lessons.length} שיעורים, שיעור כל יומיים, כך שמסיימים בערך בחמישה שבועות. שבוע 5 הוא העמקה, ואפשר לעשות אותו בקצב שלך. ובנוסף לשיעורים: תרגול על מערכות אחרות, עמוד תבניות ודף שליפה. כל שיעור לוקח רבע עד חצי שעה.</p>
      <h3>למה דווקא אפליקציית צ'אט?</h3>
      <p>צ'אט הוא אחת המערכות שהכי טוב מלמדות System Design. יש בה כמעט כל אתגר קלאסי: מיליוני חיבורים פתוחים בזמן אמת, הודעות שאסור לאבד, סדר הודעות, סטטוס "מחובר", קבוצות ענק, תמונות וסרטונים, חיפוש ואבטחה. כל מושג שתלמדי כאן מופיע גם במערכות אחרות, כמו מערכות תשלומים, מסחר או ניהול.</p>
      <h3>איך לומדים הכי טוב מהקורס</h3>
      <ul class="steps">
        <li><b>לא לדלג על החימום.</b> חזרה מרווחת (spaced repetition) היא הדרך המוכחת ביותר לזכור לאורך זמן. שאלות שטעית בהן או ניחשת חוזרות יותר.</li>
        <li><b>לכתוב את התרגיל לפני שמציצים.</b> גם תשובה חלקית או שגויה מכינה את המוח לקלוט את הפתרון.</li>
        <li><b>לסמן "כמה את בטוחה".</b> תשובה נכונה מניחוש היא לא ידע, והמערכת מתייחסת אליה בהתאם.</li>
        <li><b>לסמן מילים לא ברורות.</b> מסמנים עם העכבר ולוחצים "הוספה למאגר". פעם בכמה שיעורים יוצרים מהמאגר פרומפט לקלוד.</li>
        <li><b>לחבר לעבודה.</b> השאלה "ובעבודה שלך?" הופכת ידע כללי לידע שימושי. כדאי לשאול את הארכיטקטים אצלכם למה בחרו מה שבחרו.</li>
      </ul>
      <h3>טכני</h3>
      <p>האתר רץ על Cloudflare Workers (חינמי), וההתקדמות נשמרת ב-Cloudflare KV. התזכורות נשלחות ב-Cron פעם בשעה דרך Resend. כל האתר נעול בקוד כניסה (עוגיית סשן חתומה, והגבלה על ניסיונות כושלים). גם בלי חיבור, הכל נשמר בדפדפן ואפשר לגבות לקובץ.</p>
    </div>`;
  }

  function renderNotFound() {
    main.innerHTML = '<div class="card empty"><h2>העמוד לא נמצא</h2><a class="btn" href="#/">חזרה למפה</a></div>';
  }

  // ---------- ניווט ----------
  const currentRoute = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);

  function render() {
    const [page, arg] = currentRoute();
    closeModal();
    hideTooltip();
    $('#selectionAdd').hidden = true;
    if (!page) renderHome();
    else if (page === 'lesson') renderLesson(arg);
    else if (page === 'glossary') renderGlossary(arg);
    else if (page === 'my') renderMine();
    else if (page === 'settings') renderSettings();
    else if (page === 'about') renderAbout();
    else if (page === 'practice') arg ? renderProblem(arg) : renderPracticeList();
    else if (page === 'patterns') renderPatterns(arg);
    else if (page === 'cheatsheet') renderCheatsheet();
    else renderNotFound();
    const navKey = page === 'lesson' ? 'home' : page === 'cheatsheet' ? 'patterns' : (page || 'home');
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
    const lesson = page === 'lesson' && lessonById(arg);
    document.title = lesson ? `${lesson.id}. ${lesson.title} · מסע ל-System Design` : 'מסע ל-System Design';
    if (page === 'patterns' && arg) { const t = $('#p-' + arg); if (t) setTimeout(() => t.scrollIntoView({ behavior: 'smooth' }), 50); else window.scrollTo(0, 0); }
    else if (!(page === 'glossary' && arg)) window.scrollTo(0, 0);
    updateChrome();
  }

  function updateChrome() {
    const n = activeMine().filter((m) => !m.understood).length;
    const c = $('#myCount');
    c.hidden = !n;
    c.textContent = n;
  }

  // ---------- כלים כלליים ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    toast(msg || 'הועתק ✓');
  }

  function confetti() {
    const colors = ['#e0644d', '#4b3f8f', '#23845f', '#c98a12', '#ab9ff6'];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
      c.style.animationDelay = Math.random() * 0.4 + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
  }

  function initWidgets(root) {
    $$('.widget[data-widget]', root).forEach((el) => {
      const fn = window.SDC_WIDGETS && window.SDC_WIDGETS[el.dataset.widget];
      if (fn) fn(el); else el.remove();
    });
  }

  // ---------- טולטיפ ----------
  const tip = $('#tooltip');
  function showTooltip(a) {
    const g = G[a.dataset.term];
    if (!g) return;
    tip.innerHTML = `<b>${g.en} <span class="tt-he">· ${g.he}</span></b>${g.short}<span class="tt-more">לחיצה ← הסבר מלא במילון</span>`;
    tip.hidden = false;
    const r = a.getBoundingClientRect();
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
    let top = r.top - th - 10;
    if (top < 70) top = r.bottom + 10;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTooltip() { tip.hidden = true; }

  // ---------- סימון טקסט והוספה למאגר ----------
  const selBtn = $('#selectionAdd');
  let selText = '';
  function onSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim().replace(/\s+/g, ' ') : '';
    if (!text || text.length < 2 || text.length > 200 || !sel.rangeCount) { selBtn.hidden = true; return; }
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!node || !main.contains(node) || node.closest('textarea, input, .modal')) { selBtn.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    selText = text;
    selBtn.hidden = false;
    selBtn.style.top = window.scrollY + r.top - selBtn.offsetHeight - 8 + 'px';
    selBtn.style.left = Math.max(8, window.scrollX + r.left + r.width / 2 - selBtn.offsetWidth / 2) + 'px';
  }

  // ---------- אירועים ----------
  document.addEventListener('click', (e) => {
    if (onQuizClick(e)) return;

    const jump = e.target.closest('[data-jump]');
    if (jump) { e.preventDefault(); const t = $('#b-' + jump.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }

    const addTerm = e.target.closest('[data-add-term]');
    if (addTerm) { const g = G[addTerm.dataset.addTerm]; openMineModal({ text: `${g.en} (${g.he})`, lessonId: g.lesson, termKey: addTerm.dataset.addTerm }); return; }

    const letter = e.target.closest('[data-letter]');
    if (letter) {
      e.preventDefault();
      const first = $$('.gterm').find((el) => !el.hidden && G[el.dataset.key].en[0].toUpperCase() === letter.dataset.letter);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const mineAct = e.target.closest('[data-mine-act]');
    if (mineAct) {
      const id = mineAct.closest('[data-mine]').dataset.mine;
      const m = state.mine.find((x) => x.id === id);
      const a = mineAct.dataset.mineAct;
      if (a === 'toggle') { m.understood = !m.understood; m.updatedAt = Date.now(); save(); renderMine(); }
      if (a === 'edit') openMineModal({ edit: id });
      if (a === 'delete' && confirm('למחוק את הפריט?')) { m.deleted = true; m.updatedAt = Date.now(); save(); renderMine(); }
      return;
    }

    const theme = e.target.closest('[data-theme-set]');
    if (theme) { setTheme(theme.dataset.themeSet); $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b === theme)); return; }

    const act = e.target.closest('[data-act]');
    if (!act) return;
    const [page, arg] = currentRoute();
    switch (act.dataset.act) {
      case 'download': downloadLesson(arg); break;
      case 'print': $$('details').forEach((d) => { d.open = true; }); window.print(); break;
      case 'complete': completeLesson(Number(arg)); break;
      case 'practice-done': {
        const id = act.dataset.arg;
        state.practice[id] = { ...(state.practice[id] || {}), done: Date.now() };
        save(); toast(`תרגיל הושלם! ${practiceDone()}/${PRACTICE.length} 💪`); render();
        break;
      }
      case 'practice-prompt': {
        const pr = PRACTICE.find((x) => x.id === act.dataset.arg);
        copyText(practicePrompt(pr), 'הפרומפט הועתק, עם כל התשובות שלך. אפשר להדביק בקלוד');
        break;
      }
      case 'new-mine': openMineModal(); break;
      case 'gen-prompt':
        $('#promptOut').value = buildPrompt({ mine: $('#pMine').checked, weak: $('#pWeak').checked, quizMe: $('#pQuiz').checked });
        break;
      case 'copy-prompt': {
        const out = $('#promptOut');
        if (!out.value) out.value = buildPrompt({ mine: $('#pMine').checked, weak: $('#pWeak').checked, quizMe: $('#pQuiz').checked });
        copyText(out.value, 'הפרומפט הועתק, אפשר להדביק בקלוד ✨');
        break;
      }
      case 'save-rem': saveReminders(); break;
      case 'test-mail':
        Sync.api('/test-email', { method: 'POST' }).then(() => toast('מייל בדיקה נשלח 📨, כדאי לבדוק גם בספאם'))
          .catch((err) => toast(err.data && err.data.error === 'no_email' ? 'קודם שומרים כתובת מייל' : err.data && err.data.error === 'mail_not_configured' ? 'שירות המייל לא מוגדר בשרת' : 'השליחה נכשלה'));
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `system-design-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 500);
        break;
      }
      case 'reset':
        if (confirm('לאפס את כל ההתקדמות, התשובות והמאגר? אי אפשר לבטל את הפעולה.')) {
          const keepVisits = state.visits;
          state = { ...blank(), visits: keepVisits };
          state.mine = [];
          save();
          toast('אופס');
          render();
        }
        break;
      default: break;
    }
    void page;
  });

  // שמירה אוטומטית של תרגיל ורפלקציה
  let typingTimer = null;
  document.addEventListener('input', (e) => {
    const ex = e.target.closest('[data-ex]');
    const rf = e.target.closest('[data-reflect]');
    const pr = e.target.closest('[data-predict]');
    const wk = e.target.closest('[data-work]');
    if (wk) {
      const [lid, i] = wk.dataset.work.split(':');
      state.work[lid] = { ...(state.work[lid] || {}), [i]: wk.checked };
      if (wk.checked) toast('כל הכבוד! ככה לומדים באמת 💪');
      save();
      return;
    }
    const pa = e.target.closest('[data-pr]');
    if (pa) {
      const [pid, i] = pa.dataset.pr.split(':');
      const cur = state.practice[pid] || {};
      state.practice[pid] = { ...cur, answers: { ...(cur.answers || {}), [i]: pa.value } };
    }
    if (!ex && !rf && !pr && !pa) return;
    if (ex) state.exercises[ex.dataset.ex] = ex.value;
    if (rf) state.reflections[rf.dataset.reflect] = rf.value;
    if (pr) state.predictions[pr.dataset.predict] = pr.value;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => save(), 700);
  });

  document.addEventListener('mouseover', (e) => { const a = e.target.closest('a.term'); if (a) showTooltip(a); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('a.term')) hideTooltip(); });
  document.addEventListener('focusin', (e) => { const a = e.target.closest('a.term'); if (a) showTooltip(a); });
  document.addEventListener('focusout', (e) => { if (e.target.closest('a.term')) hideTooltip(); });
  document.addEventListener('mouseup', () => setTimeout(onSelection, 10));
  document.addEventListener('touchend', () => setTimeout(onSelection, 300));
  document.addEventListener('mousedown', (e) => { if (e.target !== selBtn) selBtn.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); selBtn.hidden = true; } });
  selBtn.addEventListener('click', () => {
    selBtn.hidden = true;
    const [page, arg] = currentRoute();
    openMineModal({ text: selText, lessonId: page === 'lesson' ? Number(arg) : null });
    window.getSelection().removeAllRanges();
  });

  window.addEventListener('scroll', () => {
    hideTooltip();
    const fill = $('#progressFill');
    if (currentRoute()[0] !== 'lesson') { fill.style.width = '0'; return; }
    const h = document.documentElement.scrollHeight - window.innerHeight;
    fill.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
  }, { passive: true });

  window.addEventListener('beforeprint', () => $$('details').forEach((d) => { d.open = true; }));
  window.addEventListener('hashchange', render);

  // ---------- ערכת נושא ----------
  function setTheme(v) {
    safeSet(THEME_KEY, v);
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    const dark = v === 'dark' || (v === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('#themeToggle').textContent = dark ? '☀️' : '🌙';
  }
  $('#themeToggle').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(dark ? 'light' : 'dark');
  });
  setTheme(safeGet(THEME_KEY) || 'auto');

  // ---------- התחלה ----------
  markVisit();
  render();
  Sync.start();
})();
