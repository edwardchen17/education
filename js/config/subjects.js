/* ===== config/subjects.js — 各程度的科目清單 =====
 * 對應需求 4.1 至 4.6
 */

export const SUBJECT_META = {
  chinese: { label: '國文', labelG5: '國語', color: 'var(--sub-chinese)', icon: '文' },
  english: { label: '英文', labelG5: '英語', color: 'var(--sub-english)', icon: 'Ａ' },
  math:    { label: '數學', color: 'var(--sub-math)',    icon: '數' },
  science: { label: '理化', color: 'var(--sub-science)', icon: '理' },
  nature:  { label: '自然', color: 'var(--sub-science)', icon: '然' },
  bio:     { label: '生物', color: 'var(--sub-bio)',     icon: '生' },
  social:  { label: '社會', color: 'var(--sub-social)',  icon: '社' }
};

/** 國中社會細分三個子領域（需求 4.3） */
export const SOCIAL_STRANDS = {
  g8: [
    { code: 'history',   label: '歷史' },
    { code: 'geography', label: '地理' },
    { code: 'civics',    label: '公民' }
  ],
  g5: [
    { code: 'taiwan', label: '台灣的地理與歷史' }
  ]
};

export const LEVEL_SUBJECTS = {
  /* 國二上學期 */
  g8: [
    { code: 'chinese' },
    { code: 'english' },
    { code: 'math' },
    { code: 'science' },
    { code: 'bio', note: '七年級內容複習' },   // 需求 4.4
    { code: 'social' }
  ],
  /* 小五上學期。自然為統整內容，不拆分為物理化學生物（需求 4.6） */
  g5: [
    { code: 'chinese' },
    { code: 'english' },
    { code: 'math' },
    { code: 'nature' },
    { code: 'social' }
  ]
};

/** 取得某程度的科目清單，附上顯示名稱 */
export function subjectsFor(level) {
  return (LEVEL_SUBJECTS[level] || []).map(s => {
    const meta = SUBJECT_META[s.code] || {};
    return {
      code: s.code,
      label: (level === 'g5' && meta.labelG5) ? meta.labelG5 : meta.label,
      color: meta.color,
      icon: meta.icon,
      note: s.note || null
    };
  });
}

/** 顯示名稱 */
export function subjectLabel(code, level) {
  const meta = SUBJECT_META[code];
  if (!meta) return code;
  return (level === 'g5' && meta.labelG5) ? meta.labelG5 : meta.label;
}

/** 預設的科目輪替順序（需求 8.5）。排課時會避開前一天用過的科目。 */
export const DEFAULT_ROTATION = {
  g8: ['math', 'chinese', 'english', 'science', 'social', 'math', 'chinese', 'bio'],
  g5: ['math', 'chinese', 'english', 'nature', 'math', 'chinese', 'social']
};
