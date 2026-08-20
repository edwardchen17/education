/* ===== answer.js — 答案正規化與比對 =====
 *
 * 各題型的比對規則見 design 文件。核心難點是計算題：
 * 學生可能寫 3/4、0.75、.75、６/８、18 km、2√3、1 1/2，
 * 這些在數學上等價或可解析的形式都要接受。
 */

import { toHalfWidth } from '../core.js';

/* ------------------------------------------------------------------ */
/* 文字正規化                                                          */
/* ------------------------------------------------------------------ */

/** 填空與簡答用的文字正規化 */
export function normalizeText(s) {
  return toHalfWidth(String(s ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 更寬鬆的比較：連空白都不計 */
function squeeze(s) {
  return normalizeText(s).replace(/\s+/g, '');
}

/* ------------------------------------------------------------------ */
/* 數值解析                                                            */
/* ------------------------------------------------------------------ */

/* 常見單位。比對時若整串解析失敗，會嘗試去掉尾端單位再解析一次。 */
const UNITS = [
  '平方公分', '平方公尺', '平方公里', '立方公分', '立方公尺',
  '公里', '公尺', '公分', '毫米', '公斤', '公克', '毫升', '公升',
  '小時', '分鐘', '秒', '天', '度', '元', '人', '個', '本', '倍', '成',
  'km/h', 'm/s', 'cm2', 'm2', 'cm3', 'm3',
  'km', 'cm', 'mm', 'kg', 'ml', 'mL', 'L', 'g', 'm', 'N', 'J', 'W', 'V', 'A',
  '°C', '℃', '°', 'Ω'
];

/** 去掉尾端的單位，回傳去掉後的字串（沒有單位就原樣回傳） */
function stripUnit(s) {
  let t = s.trim();
  for (const u of UNITS) {
    if (t.toLowerCase().endsWith(u.toLowerCase())) {
      return t.slice(0, t.length - u.length).trim();
    }
  }
  return t;
}

/** 前處理：全形轉半形、統一運算符號、去掉千分位逗號 */
function prepare(s) {
  return toHalfWidth(String(s ?? ''))
    .replace(/[,\u3001]/g, '')          // 千分位與頓號
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')             // 各種減號
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\\pi/g, 'pi')
    .replace(/\\times/g, '*')
    .replace(/\\div/g, '/')
    .trim();
}

/** 帶分數：`1 1/2`、`1又1/2` */
function parseMixed(s) {
  const m = /^([+-]?\d+)(?:\s+|又)(\d+)\s*\/\s*(\d+)$/.exec(s.trim());
  if (!m) return null;
  const whole = Number(m[1]);
  const num = Number(m[2]);
  const den = Number(m[3]);
  if (den === 0) return null;
  const sign = whole < 0 || m[1].startsWith('-') ? -1 : 1;
  return sign * (Math.abs(whole) + num / den);
}

class Parser {
  constructor(s) { this.s = s; this.i = 0; }

  ws() { while (this.i < this.s.length && this.s[this.i] === ' ') this.i++; }
  peek() { this.ws(); return this.s[this.i]; }
  eof() { this.ws(); return this.i >= this.s.length; }

  expr() {
    let v = this.term();
    for (;;) {
      const c = this.peek();
      if (c === '+') { this.i++; v += this.term(); }
      else if (c === '-') { this.i++; v -= this.term(); }
      else return v;
    }
  }

  term() {
    let v = this.unary();
    for (;;) {
      const c = this.peek();
      if (c === '*') { this.i++; v *= this.unary(); }
      else if (c === '/') { this.i++; const d = this.unary(); if (d === 0) throw new RangeError('除以零'); v /= d; }
      else if (this.startsAtom()) { v *= this.unary(); }   // 隱含乘法：2pi、3sqrt2
      else return v;
    }
  }

  unary() {
    const c = this.peek();
    if (c === '-') { this.i++; return -this.unary(); }
    if (c === '+') { this.i++; return this.unary(); }
    return this.power();
  }

  power() {
    const base = this.atom();
    if (this.peek() === '^') { this.i++; return Math.pow(base, this.unary()); }
    return base;
  }

  startsAtom() {
    const c = this.peek();
    if (c === undefined) return false;
    if (/[0-9.(]/.test(c)) return true;
    return /^(pi|sqrt)/.test(this.s.slice(this.i));
  }

  atom() {
    this.ws();
    const rest = this.s.slice(this.i);

    if (rest.startsWith('sqrt')) {
      this.i += 4;
      const inner = this.atom();
      if (inner < 0) throw new RangeError('負數開平方');
      return Math.sqrt(inner);
    }
    if (rest.startsWith('pi')) { this.i += 2; return Math.PI; }

    if (this.s[this.i] === '(' || this.s[this.i] === '{') {
      const close = this.s[this.i] === '(' ? ')' : '}';
      this.i++;
      const v = this.expr();
      if (this.peek() !== close) throw new SyntaxError('括號沒有閉合');
      this.i++;
      return v;
    }

    const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(rest);
    if (m) { this.i += m[0].length; return Number(m[0]); }

    throw new SyntaxError('看不懂的字元：' + (this.s[this.i] ?? '結尾'));
  }
}

/**
 * 把學生輸入的字串解析成數值。無法解析時回傳 NaN。
 * 支援：整數、小數、分數、帶分數、根號、次方、圓周率、科學記號、帶單位。
 */
export function parseNumeric(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return NaN;

  const attempt = str => {
    const mixed = parseMixed(str);
    if (mixed !== null) return mixed;
    const s = prepare(str);
    if (!s) return NaN;
    try {
      const p = new Parser(s);
      const v = p.expr();
      if (!p.eof()) return NaN;
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  };

  // 百分比
  const pct = /^(.*)%$/.exec(raw);
  if (pct) {
    const v = attempt(pct[1]);
    if (!Number.isNaN(v)) return v;      // 35% 視為 35，題目自行約定單位
  }

  let v = attempt(raw);
  if (!Number.isNaN(v)) return v;

  // 去掉尾端單位再試
  const noUnit = stripUnit(raw);
  if (noUnit !== raw) {
    v = attempt(noUnit);
    if (!Number.isNaN(v)) return v;
  }

  return NaN;
}

/* ------------------------------------------------------------------ */
/* 各題型比對                                                          */
/* ------------------------------------------------------------------ */

/** 取出選擇題的正解索引 */
export function correctIndices(question) {
  return (question.options || [])
    .map((o, i) => (o.correct ? i : -1))
    .filter(i => i >= 0);
}

/**
 * 比對答案。
 * @param {object} question 題目快照
 * @param {*} raw 學生作答
 * @returns {{correct: boolean|null, needsGrading: boolean, normalized: *, detail: string}}
 */
export function check(question, raw) {
  const type = question.type;

  if (type === 'short' || type === 'essay') {
    return { correct: null, needsGrading: true, normalized: String(raw ?? ''), detail: '待老師批改' };
  }

  const blank = raw === null || raw === undefined || raw === '' ||
                (Array.isArray(raw) && raw.length === 0);
  if (blank) {
    return { correct: false, needsGrading: false, normalized: null, detail: '未作答' };
  }

  if (type === 'mc') {
    const idx = Number(raw);
    const want = correctIndices(question);
    return {
      correct: want.includes(idx),
      needsGrading: false,
      normalized: idx,
      detail: ''
    };
  }

  if (type === 'mmc') {
    const got = [...new Set((Array.isArray(raw) ? raw : [raw]).map(Number))].sort((a, b) => a - b);
    const want = correctIndices(question).sort((a, b) => a - b);
    const same = got.length === want.length && got.every((v, i) => v === want[i]);
    return {
      correct: same,
      needsGrading: false,
      normalized: got,
      detail: same ? '' : '多選題必須完全選對才算對'
    };
  }

  if (type === 'fill') {
    const accept = question.answer?.accept ?? [question.answer?.value];
    const strict = !!question.answer?.strict;
    const mine = strict ? String(raw).trim() : normalizeText(raw);
    const mineSq = strict ? mine : squeeze(raw);

    const hit = accept.some(a => {
      if (a === undefined || a === null) return false;
      const want = strict ? String(a).trim() : normalizeText(a);
      if (mine === want) return true;
      if (!strict && mineSq === squeeze(a)) return true;
      // 若兩邊都是數字，也接受數值相等（例如 08 與 8）
      const x = parseNumeric(raw), y = parseNumeric(a);
      return !Number.isNaN(x) && !Number.isNaN(y) && Math.abs(x - y) < 1e-9;
    });

    return { correct: hit, needsGrading: false, normalized: mine, detail: '' };
  }

  if (type === 'calc') {
    const spec = question.answer || {};
    const tol = spec.tolerance ?? 1e-6;
    const mine = parseNumeric(raw);

    if (Number.isNaN(mine)) {
      return {
        correct: false, needsGrading: false, normalized: String(raw),
        detail: '看不懂這個答案的寫法，已保留原始輸入'
      };
    }

    const targets = spec.accept ? spec.accept.map(parseNumeric)
                                : [typeof spec.value === 'number' ? spec.value : parseNumeric(spec.value)];
    const hit = targets.some(t => !Number.isNaN(t) && Math.abs(mine - t) <= tol);

    return { correct: hit, needsGrading: false, normalized: mine, detail: '' };
  }

  return { correct: false, needsGrading: false, normalized: raw, detail: '未知的題型：' + type };
}

/** 把正解整理成可顯示的字串，用於檢討畫面 */
export function answerDisplay(question) {
  const t = question.type;
  if (t === 'mc' || t === 'mmc') {
    return correctIndices(question).map(i => `(${'ABCDEFGH'[i]})`).join('、');
  }
  if (t === 'fill') {
    const accept = question.answer?.accept ?? [question.answer?.value];
    return accept.filter(v => v != null).join(' 或 ');
  }
  if (t === 'calc') {
    const v = question.answer?.value;
    const u = question.answer?.unit ? ' ' + question.answer.unit : '';
    return `${v}${u}`;
  }
  return '（由老師批改）';
}
