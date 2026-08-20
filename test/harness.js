/* ===== test/harness.js — 無頭測試骨架 =====
 * 以 Node 執行，不需要瀏覽器。提供三樣東西：
 *   1. 測試註冊與斷言
 *   2. 瀏覽器環境的最小替身（document / window / localStorage）
 *   3. Supabase 用戶端的記憶體假實作，讓資料層可在無網路下測試
 */

/* ------------------------------------------------------------------ */
/* 測試註冊與執行                                                      */
/* ------------------------------------------------------------------ */

const suites = [];
let current = null;

export function suite(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function test(name, fn) {
  if (!current) throw new Error('test() 必須寫在 suite() 內');
  current.tests.push({ name, fn });
}

export class AssertError extends Error {}

function fail(msg, extra) {
  throw new AssertError(extra ? `${msg}\n      ${extra}` : msg);
}

export function ok(cond, msg = '預期為真') {
  if (!cond) fail(msg);
}

export function eq(actual, expected, msg = '值不相等') {
  if (actual !== expected) fail(msg, `實際 ${fmt(actual)}　預期 ${fmt(expected)}`);
}

export function ne(actual, expected, msg = '值不應相等') {
  if (actual === expected) fail(msg, `兩者都是 ${fmt(actual)}`);
}

export function deepEq(actual, expected, msg = '結構不相等') {
  const a = JSON.stringify(sortKeys(actual));
  const b = JSON.stringify(sortKeys(expected));
  if (a !== b) fail(msg, `實際 ${a}\n      預期 ${b}`);
}

export function approx(actual, expected, tol = 1e-9, msg = '數值誤差過大') {
  if (!(Math.abs(actual - expected) <= tol)) {
    fail(msg, `實際 ${fmt(actual)}　預期 ${fmt(expected)} ± ${tol}`);
  }
}

export function throws(fn, msg = '預期丟出例外') {
  try { fn(); } catch { return; }
  fail(msg);
}

export async function rejects(promise, msg = '預期 Promise 被拒絕') {
  try { await promise; } catch { return; }
  fail(msg);
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || v == null) return String(v);
  return JSON.stringify(v);
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  }
  return v;
}

/** 執行所有已註冊的測試，回傳 { total, passed, failed } */
export async function runAll() {
  let total = 0, passed = 0;
  const failures = [];

  for (const s of suites) {
    console.log(`\n  ${s.name}`);
    for (const t of s.tests) {
      total++;
      try {
        await t.fn();
        passed++;
        console.log(`    \x1b[32m✓\x1b[0m ${t.name}`);
      } catch (err) {
        const isAssert = err instanceof AssertError;
        console.log(`    \x1b[31m✗\x1b[0m ${t.name}`);
        console.log(`      \x1b[31m${err.message}\x1b[0m`);
        if (!isAssert && err.stack) {
          const line = err.stack.split('\n').find(l => l.includes('.js:') && !l.includes('harness.js'));
          if (line) console.log(`      \x1b[90m${line.trim()}\x1b[0m`);
        }
        failures.push({ suite: s.name, test: t.name, message: err.message });
      }
    }
  }

  const failed = total - passed;
  console.log('\n' + '─'.repeat(60));
  if (failed === 0) {
    console.log(`  \x1b[32m全部通過\x1b[0m　${passed} / ${total}`);
  } else {
    console.log(`  \x1b[31m失敗 ${failed} 項\x1b[0m　通過 ${passed} / ${total}`);
  }
  console.log('─'.repeat(60));

  return { total, passed, failed, failures };
}

/* ------------------------------------------------------------------ */
/* 瀏覽器環境替身                                                      */
/* ------------------------------------------------------------------ */

/** 安裝最小的瀏覽器全域物件，讓瀏覽器模組能在 Node 載入 */
export function installBrowserStubs() {
  if (globalThis.__stubbed) return;
  globalThis.__stubbed = true;

  const makeStorage = () => {
    const store = new Map();
    return {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: i => [...store.keys()][i] ?? null
    };
  };

  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();

  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { return c; }, removeChild() {}, remove() {},
    querySelector: () => el(), querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, focus() {}, click() {},
    getContext: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    setAttribute() {}, getAttribute: () => null, children: []
  });

  globalThis.document = {
    documentElement: el(),
    body: el(),
    getElementById: () => el(),
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {}, removeEventListener() {}
  };

  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.location = { hash: '', href: 'http://localhost/', reload() {} };
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

  // Node 22 以後內建唯讀的 navigator，不能直接覆蓋，只能補上缺的屬性
  if (!('navigator' in globalThis)) {
    globalThis.navigator = { onLine: true, userAgent: 'node' };
  } else if (globalThis.navigator.onLine === undefined) {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    } catch { /* 補不上就算了，isOnline() 會回傳 true */ }
  }
}

/** 清空替身的 localStorage 與 sessionStorage，供測試之間互不干擾 */
export function resetStorage() {
  if (globalThis.localStorage) globalThis.localStorage.clear();
  if (globalThis.sessionStorage) globalThis.sessionStorage.clear();
}

/* ------------------------------------------------------------------ */
/* Supabase 假用戶端                                                   */
/* ------------------------------------------------------------------ */

/* 各表的唯一鍵，用來模擬資料庫的唯一約束 */
const UNIQUE_KEYS = {
  students:      [['id']],
  subject_state: [['student_id', 'subject']],
  lessons:       [['student_id', 'lesson_date', 'slot_of_day']],
  attempts:      [['lesson_id', 'seq']],
  topic_mastery: [['student_id', 'topic']],
  badges:        [['student_id', 'code', 'level']],
  app_settings:  [['id']]
};

const SERIAL_TABLES = ['lessons', 'attempts', 'points_ledger', 'notifications'];

/**
 * 建立記憶體版的 Supabase 用戶端。
 * @param {object} seed 初始資料，例如 { students: [...] }
 */
export function makeFakeSupabase(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(name, rows.map(r => ({ ...r })));
  }
  const rowsOf = name => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };

  let serial = 1000;
  let session = null;
  const authListeners = [];

  /* --- 唯一鍵衝突偵測 --- */
  function conflictOf(table, row) {
    const keys = UNIQUE_KEYS[table];
    if (!keys) return null;
    for (const key of keys) {
      if (key.some(k => row[k] === undefined)) continue;
      const hit = rowsOf(table).find(r => key.every(k => r[k] === row[k]));
      if (hit) return { key, existing: hit };
    }
    return null;
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.payload = null;
      this.opts = {};
      this.sort = null;
      this.max = null;
      this.mode = null;          // single | maybeSingle
      this.returnRows = true;
    }

    select() { if (this.op === 'select') this.returnRows = true; else this.returnRows = true; return this; }
    insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.returnRows = false; return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.opts = opts; this.payload = Array.isArray(rows) ? rows : [rows]; this.returnRows = false; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; this.returnRows = false; return this; }
    delete() { this.op = 'delete'; this.returnRows = false; return this; }

    eq(c, v)  { this.filters.push(r => r[c] === v); return this; }
    neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
    lt(c, v)  { this.filters.push(r => r[c] <  v); return this; }
    lte(c, v) { this.filters.push(r => r[c] <= v); return this; }
    gt(c, v)  { this.filters.push(r => r[c] >  v); return this; }
    gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
    is(c, v)  { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    in(c, arr){ this.filters.push(r => arr.includes(r[c])); return this; }

    order(col, o = {}) { this.sort = { col, asc: o.ascending !== false }; return this; }
    limit(n) { this.max = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybeSingle'; return this; }

    _match(r) { return this.filters.every(f => f(r)); }

    _run() {
      const list = rowsOf(this.table);

      if (this.op === 'insert' || this.op === 'upsert') {
        const out = [];
        for (const raw of this.payload) {
          const row = { ...raw };
          const hit = conflictOf(this.table, row);

          if (hit) {
            if (this.op === 'insert') {
              return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${this.table}` } };
            }
            if (this.opts.ignoreDuplicates) { out.push(hit.existing); continue; }
            Object.assign(hit.existing, row);       // upsert 覆蓋
            out.push(hit.existing);
            continue;
          }

          if (SERIAL_TABLES.includes(this.table) && row.id === undefined) row.id = ++serial;
          if (row.created_at === undefined) row.created_at = new Date().toISOString();
          list.push(row);
          out.push(row);
        }
        return this._shape(out);
      }

      if (this.op === 'update') {
        const hits = list.filter(r => this._match(r));
        hits.forEach(r => Object.assign(r, this.payload));
        return this._shape(hits);
      }

      if (this.op === 'delete') {
        const keep = [], gone = [];
        for (const r of list) (this._match(r) ? gone : keep).push(r);
        tables.set(this.table, keep);
        return this._shape(gone);
      }

      /* select */
      let out = list.filter(r => this._match(r));
      if (this.sort) {
        const { col, asc } = this.sort;
        out = out.slice().sort((a, b) => {
          const x = a[col], y = b[col];
          if (x === y) return 0;
          return (x > y ? 1 : -1) * (asc ? 1 : -1);
        });
      }
      if (this.max != null) out = out.slice(0, this.max);
      return this._shape(out);
    }

    _shape(rows) {
      const copy = rows.map(r => ({ ...r }));
      if (this.mode === 'single') {
        if (copy.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: `預期一列，實際 ${copy.length} 列` } };
        }
        return { data: copy[0], error: null };
      }
      if (this.mode === 'maybeSingle') {
        return { data: copy[0] ?? null, error: null };
      }
      return { data: copy, error: null };
    }

    then(resolve, reject) {
      let result;
      try { result = this._run(); }
      catch (err) { result = { data: null, error: { message: err.message } }; }
      return Promise.resolve(result).then(resolve, reject);
    }
  }

  return {
    from: name => new Query(name),

    auth: {
      async signInWithPassword({ email, password }) {
        if (password === 'correct-password') {
          session = { user: { id: 'fake-user', email }, access_token: 'fake-token' };
          authListeners.forEach(fn => fn('SIGNED_IN', session));
          return { data: { session, user: session.user }, error: null };
        }
        return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
      },
      async signOut() {
        session = null;
        authListeners.forEach(fn => fn('SIGNED_OUT', null));
        return { error: null };
      },
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(fn) {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      }
    },

    /* 測試輔助：直接檢視或設定內部資料 */
    __tables: tables,
    __rows: name => rowsOf(name),
    __setSession: s => { session = s; }
  };
}
