/* ===== mathfmt.js — 輕量數學式渲染器 =====
 *
 * 只處理國中小數學會用到的少數構造，因此不需要引入 KaTeX（約 300 KB）。
 * 支援語法：
 *   \frac{分子}{分母}      分數
 *   \sqrt{被開方數}        根號
 *   \sqrt[n]{被開方數}     n 次方根
 *   x^{2}  x^2            上標
 *   x_{1}  x_1            下標
 *   \overline{AB}         線段
 *   符號：\times \div \pm \mp \le \ge \ne \approx \pi \cdot \infty
 *         \deg \angle \triangle \parallel \perp \therefore \because
 *
 * 其餘文字原樣輸出（並做 HTML 轉義）。
 */

const SYMBOLS = {
  times: '×', div: '÷', pm: '±', mp: '∓',
  le: '≤', ge: '≥', ne: '≠', approx: '≈',
  pi: 'π', cdot: '·', infty: '∞',
  deg: '°', angle: '∠', triangle: '△',
  parallel: '∥', perp: '⊥',
  therefore: '∴', because: '∵',
  alpha: 'α', beta: 'β', theta: 'θ',
  Delta: 'Δ', sum: 'Σ'
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 讀取 { ... }，支援嵌套。回傳 { body, next }。 */
function readBrace(s, i) {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, j), next: j + 1 };
    }
  }
  return null;   // 括號沒閉合
}

/** 讀取 [ ... ]（選用參數） */
function readBracket(s, i) {
  if (s[i] !== '[') return null;
  const j = s.indexOf(']', i);
  if (j < 0) return null;
  return { body: s.slice(i + 1, j), next: j + 1 };
}

/** 讀取上下標的內容：{ ... } 或單一字元 */
function readScript(s, i) {
  const g = readBrace(s, i);
  if (g) return g;
  if (i < s.length) return { body: s[i], next: i + 1 };
  return null;
}

/**
 * 把數學式標記轉為 HTML 片段。
 * @param {string} src
 * @returns {string}
 */
export function renderMath(src) {
  return `<span class="math">${convert(String(src ?? ''))}</span>`;
}

function convert(s) {
  let out = '';
  let i = 0;
  let plain = '';

  const flush = () => { if (plain) { out += esc(plain); plain = ''; } };

  while (i < s.length) {
    const ch = s[i];

    /* 反斜線命令 */
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (!m) { plain += ch; i++; continue; }
      const name = m[1];
      let j = i + m[0].length;

      if (name === 'frac') {
        const a = readBrace(s, j);
        const b = a ? readBrace(s, a.next) : null;
        if (a && b) {
          flush();
          out += `<span class="frac"><span class="num">${convert(a.body)}</span>` +
                 `<span class="den">${convert(b.body)}</span></span>`;
          i = b.next;
          continue;
        }
      }

      if (name === 'sqrt') {
        const idx = readBracket(s, j);
        const g = readBrace(s, idx ? idx.next : j);
        if (g) {
          flush();
          const sup = idx ? `<span class="root-idx">${convert(idx.body)}</span>` : '';
          out += `<span class="sqrt">${sup}<span class="radical">√</span>` +
                 `<span class="radicand">${convert(g.body)}</span></span>`;
          i = g.next;
          continue;
        }
      }

      if (name === 'overline') {
        const g = readBrace(s, j);
        if (g) {
          flush();
          out += `<span class="overline">${convert(g.body)}</span>`;
          i = g.next;
          continue;
        }
      }

      if (SYMBOLS[name]) {
        flush();
        out += SYMBOLS[name];
        i = j;
        continue;
      }

      /* 不認識的命令，原樣輸出 */
      plain += m[0];
      i = j;
      continue;
    }

    /* 上標 */
    if (ch === '^') {
      const g = readScript(s, i + 1);
      if (g) { flush(); out += `<sup>${convert(g.body)}</sup>`; i = g.next; continue; }
    }

    /* 下標 */
    if (ch === '_') {
      const g = readScript(s, i + 1);
      if (g) { flush(); out += `<sub>${convert(g.body)}</sub>`; i = g.next; continue; }
    }

    plain += ch;
    i++;
  }

  flush();
  return out;
}

/**
 * 轉成純文字，用於語音朗讀、純文字比較與 title 屬性。
 * @param {string} src
 */
export function mathToPlain(src) {
  let s = String(src ?? '');

  // 分數 → a/b
  s = replaceCommand(s, 'frac', (a, b) => `${a}/${b}`, 2);
  // 根號
  s = replaceCommand(s, 'sqrt', a => `根號${a}`, 1);
  s = replaceCommand(s, 'overline', a => `線段${a}`, 1);

  // 由長到短替換，否則 \therefore 會被 \theta 之類的短名稱切壞
  for (const k of Object.keys(SYMBOLS).sort((a, b) => b.length - a.length)) {
    s = s.split('\\' + k).join(SYMBOLS[k]);
  }

  // 上下標
  s = s.replace(/\^\{([^}]*)\}/g, '^$1').replace(/_\{([^}]*)\}/g, '_$1');
  return s;
}

/** 反覆展開某個帶 n 個大括號參數的命令 */
function replaceCommand(s, name, fn, argc) {
  const tag = '\\' + name;
  let guard = 0;
  while (s.includes(tag) && guard++ < 50) {
    const i = s.indexOf(tag);
    let j = i + tag.length;
    // 跳過選用參數
    const br = readBracket(s, j);
    if (br) j = br.next;
    const args = [];
    for (let k = 0; k < argc; k++) {
      const g = readBrace(s, j);
      if (!g) break;
      args.push(mathToPlain(g.body));
      j = g.next;
    }
    if (args.length < argc) break;
    s = s.slice(0, i) + fn(...args) + s.slice(j);
  }
  return s;
}

/** 判斷字串裡是否含有需要渲染的數學標記 */
export function hasMath(src) {
  return /\\[A-Za-z]+|[\^_]/.test(String(src ?? ''));
}
