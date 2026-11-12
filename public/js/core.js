// רישום התוכן: קבצי השיעורים והמילון קוראים לפונקציות האלה.
window.SDC = {
  lessons: [],
  glossary: {},
  weeks: {
    1: { title: 'יסודות', sub: 'לחשוב, למדוד, לגדול', color: 'w1' },
    2: { title: 'נתונים בקנה מידה', sub: 'איפה שומרים ואיך לא מאבדים', color: 'w2' },
    3: { title: 'תקשורת ושירותים', sub: 'איך הרכיבים מדברים זה עם זה', color: 'w3' },
    4: { title: 'מקצוענות', sub: 'מדיה, אבטחה, ותכנון מלא', color: 'w4' },
  },
  lesson(def) {
    this.lessons.push(def);
    this.lessons.sort((a, b) => a.id - b.id);
  },
  terms(defs) {
    Object.assign(this.glossary, defs);
  },
};
