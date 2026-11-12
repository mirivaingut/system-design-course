// בדיקת תקינות התוכן: מונחים, שאלות, ווידג'טים. הרצה: npm run check
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ctx = { window: {}, console };
ctx.window = ctx;
vm.createContext(ctx);
const run = (p) => vm.runInContext(readFileSync(join(root, p), 'utf8'), ctx, { filename: p });

run('js/core.js');
run('data/glossary.js');
const lessonFiles = readdirSync(join(root, 'data/lessons')).filter((f) => f.endsWith('.js')).sort();
lessonFiles.forEach((f) => run('data/lessons/' + f));
run('data/patterns.js');
run('data/practice.js');
run('data/cheatsheet.js');
const widgetSrc = readFileSync(join(root, 'js/widgets.js'), 'utf8');
const widgetNames = new Set([...widgetSrc.matchAll(/W\.(\w+)\s*=/g)].map((m) => m[1]));

const { lessons, glossary } = ctx.SDC;
const errors = [];
const used = new Set();
const termRe = /\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g;
const scan = (where, s) => {
  for (const m of String(s ?? '').matchAll(termRe)) {
    used.add(m[1]);
    if (!glossary[m[1]]) errors.push(`${where}: unknown term [[${m[1]}]]`);
  }
  for (const m of String(s ?? '').matchAll(/data-widget="(\w+)"/g)) {
    if (!widgetNames.has(m[1])) errors.push(`${where}: unknown widget ${m[1]}`);
  }
};
const walk = (where, v) => {
  if (typeof v === 'string') scan(where, v);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(`${where}[${i}]`, x));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(`${where}.${k}`, x));
};

if (lessons.length !== 18) errors.push(`expected 18 lessons, got ${lessons.length}`);
const qids = new Set();
lessons.forEach((l, i) => {
  if (l.id !== i + 1) errors.push(`lesson order: index ${i} has id ${l.id}`);
  for (const k of ['slug', 'week', 'icon', 'title', 'subtitle', 'goals', 'crisis', 'sections', 'phrases', 'exercise', 'quiz', 'reflection']) {
    if (l[k] === undefined) errors.push(`lesson ${l.id}: missing ${k}`);
  }
  walk(`lesson ${l.id}`, l);
  if (!l.predict) errors.push(`lesson ${l.id}: missing predict`);
  if (!Array.isArray(l.work) || l.work.length < 2) errors.push(`lesson ${l.id}: work needs 2+ tasks`);
  [...l.quiz, ...(l.review || [])].forEach((q) => {
    if (qids.has(q.id)) errors.push(`duplicate question id ${q.id}`);
    qids.add(q.id);
    if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${q.id}: options`);
    if (!Array.isArray(q.explain) || q.explain.length !== q.options.length) errors.push(`${q.id}: explain count ${q.explain && q.explain.length} != options ${q.options.length}`);
    if (!(q.answer >= 0 && q.answer < q.options.length)) errors.push(`${q.id}: answer out of range`);
  });
});

const { patterns = [], patternQuiz = [], practice = [], cheatsheet } = ctx.SDC;
const lessonIds = new Set(lessons.map((l) => l.id));
const patternIds = new Set(patterns.map((p) => p.id));
patterns.forEach((p) => {
  walk(`pattern ${p.id}`, p);
  p.lessons.forEach((id) => { if (!lessonIds.has(id)) errors.push(`pattern ${p.id}: bad lesson ${id}`); });
});
patternQuiz.forEach((q) => {
  walk(`pattern quiz ${q.id}`, q);
  if (qids.has(q.id)) errors.push(`duplicate question id ${q.id}`);
  qids.add(q.id);
  if (q.explain.length !== q.options.length) errors.push(`${q.id}: explain count`);
  if (!(q.answer >= 0 && q.answer < q.options.length)) errors.push(`${q.id}: answer out of range`);
});
practice.forEach((p) => {
  walk(`practice ${p.id}`, p);
  if (!lessonIds.has(p.after)) errors.push(`practice ${p.id}: bad lesson ${p.after}`);
  p.patterns.forEach((id) => { if (!patternIds.has(id)) errors.push(`practice ${p.id}: unknown pattern ${id}`); });
  for (const k of ['mid', 'senior', 'staff']) if (!p.levels[k]) errors.push(`practice ${p.id}: missing level ${k}`);
});
if (cheatsheet) {
  walk('cheatsheet', cheatsheet);
  [...cheatsheet.defaults.map((r) => r[3]), ...cheatsheet.mistakes.map((r) => r[2])].forEach((id) => { if (!lessonIds.has(id)) errors.push(`cheatsheet: bad lesson ${id}`); });
}
lessons.forEach((l) => (l.further || []).forEach((f, i) => { if (!f.title || !f.source || !f.why) errors.push(`lesson ${l.id}: further[${i}] incomplete`); }));

Object.entries(glossary).forEach(([k, g]) => {
  for (const f of ['en', 'he', 'lesson', 'short', 'long']) if (!g[f]) errors.push(`glossary ${k}: missing ${f}`);
  if (!lessons.find((l) => l.id === g.lesson)) errors.push(`glossary ${k}: bad lesson ${g.lesson}`);
  (g.related || []).forEach((r) => { if (!glossary[r]) errors.push(`glossary ${k}: related "${r}" missing`); });
  scan(`glossary ${k}`, g.long); scan(`glossary ${k}`, g.example);
});

const unused = Object.keys(glossary).filter((k) => !used.has(k));
const totalQ = qids.size;
console.log(`lessons: ${lessons.length}, questions: ${totalQ}, glossary terms: ${Object.keys(glossary).length}, widgets: ${widgetNames.size}, patterns: ${patterns.length}, practice: ${practice.length}`);
if (unused.length) console.log(`terms not linked from any lesson (still in glossary): ${unused.join(', ')}`);
if (errors.length) { console.error('\n✗ ' + errors.join('\n✗ ')); process.exit(1); }
console.log('✓ content OK');
