/* ===== local.js — 瀏覽器內的本機資料庫 =====
 *
 * 提供 db.js 需要的那一小塊 Supabase 查詢介面，資料存在 sessionStorage。
 * 用途是訪客試用模式：完全不連後端，每個分頁一個獨立沙盒，
 * 關掉分頁資料就消失，也絕對碰不到家庭帳號的資料。
 *
 * 只實作 db.js 真正用到的操作。刻意不做通用化，
 * 缺少的操作會直接丟例外，好讓問題在開發期就浮現，而不是安靜地回錯資料。
 */

const STORE_KEY = 'edu.demo.db';

/* 課堂與作答的 id 從很大的號碼開始編，
 * 這樣暫存（edu.draft.<lessonId>）不會和家庭帳號的課堂撞號。 */
const SERIAL_BASE = 900000;

const SERIAL_TABLES = new Set(['lessons', 'attempts', 'points_ledger', 'notifications']);

/* 模擬資料庫的唯一約束，讓 createIfAbsent 之類的幂等寫法照樣成立 */
const UNIQUE_KEYS = {
  students:      [['id']],
  subject_state: [['student_id', 'subject']],
  lessons:       [['student_id', 'lesson_date', 'slot_of_day']],
  attempts:      [['lesson_id', 'seq']],
  topic_mastery: [['student_id', 'topic']],
  badges:        [['student_id', 'code', 'level']],
  app_settings:  [['id']]
};

const FAKE_SESSION = {
  user: { id: 'demo-visitor', email: 'demo@local' },
  access_token: 'demo'
};

/* ------------------------------------------------------------------ */
/* 建立用戶端                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} seed  初始資料，例如 { students: [...] }。只有在儲存空間
 *                       裡沒有既有資料時才會套用，避免重新載入頁面就被清掉。
 */
export function makeLocalClient(seed = {}) {
  const state = load() || { tables: clone(seed), serial: SERIAL_BASE };
  let dirty = false;

  const rowsOf = name => {
    if (!state.tables[name]) state.tables[name] = [];
    return state.tables[name];
  };

  const persist = () => {
    if (dirty) return;
    dirty = true;
    /* 一輪事件迴圈只寫一次，避免逐列寫入時反覆序列化整個資料庫 */
    Promise.resolve().then(() => { dirty = false; save(state); });
  };

  function conflictOf(table, row) {
    const keys = UNIQUE_KEYS[table];
    if (!keys) return null;
    for (const key of keys) {
      if (key.some(k => row[k] === undefined)) continue;
      const hit = rowsOf(table).find(r => key.every(k => r[k] === row[k]));
      if (hit) return hit;
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
      this.mode = null;
    }

    select() { return this; }
    insert(rows) { this.op = 'insert'; this.payload = arr(rows); return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.opts = opts; this.payload = arr(rows); return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    delete() { this.op = 'delete'; return this; }

    eq(c, v)  { this.filters.push(r => r[c] === v); return this; }
    neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
    lt(c, v)  { this.filters.push(r => r[c] <  v); return this; }
    lte(c, v) { this.filters.push(r => r[c] <= v); return this; }
    gt(c, v)  { this.filters.push(r => r[c] >  v); return this; }
    gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
    is(c, v)  { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    in(c, list) { this.filters.push(r => list.includes(r[c])); return this; }

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
              return { data: null, error: { code: '23505', message: '資料重複' } };
            }
            if (this.opts.ignoreDuplicates) { out.push(hit); continue; }
            Object.assign(hit, row);
            out.push(hit);
            continue;
          }

          if (SERIAL_TABLES.has(this.table) && row.id === undefined) row.id = ++state.serial;
          if (row.created_at === undefined) row.created_at = new Date().toISOString();
          list.push(row);
          out.push(row);
        }
        persist();
        return this._shape(out);
      }

      if (this.op === 'update') {
        const hits = list.filter(r => this._match(r));
        hits.forEach(r => Object.assign(r, this.payload));
        persist();
        return this._shape(hits);
      }

      if (this.op === 'delete') {
        const keep = [], gone = [];
        for (const r of list) (this._match(r) ? gone : keep).push(r);
        state.tables[this.table] = keep;
        persist();
        return this._shape(gone);
      }

      let out = list.filter(r => this._match(r));
      if (this.sort) {
        const { col, asc } = this.sort;
        out = out.slice().sort((a, b) => {
          const x = a[col], y = b[col];
          if (x === y) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          return (x > y ? 1 : -1) * (asc ? 1 : -1);
        });
      }
      if (this.max != null) out = out.slice(0, this.max);
      return this._shape(out);
    }

    _shape(rows) {
      const copy = rows.map(r => clone(r));
      if (this.mode === 'single') {
        if (copy.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: `預期一列，實際 ${copy.length} 列` } };
        }
        return { data: copy[0], error: null };
      }
      if (this.mode === 'maybeSingle') return { data: copy[0] ?? null, error: null };
      return { data: copy, error: null };
    }

    then(resolve, reject) {
      let res;
      try { res = this._run(); }
      catch (err) { res = { data: null, error: { message: err.message } }; }
      return Promise.resolve(res).then(resolve, reject);
    }
  }

  return {
    from: name => new Query(name),

    /* 訪客模式沒有真正的登入，回一個固定的假 session
     * 讓路由守門的 hasSession() 判定為已登入。 */
    auth: {
      async getSession() { return { data: { session: FAKE_SESSION }, error: null }; },
      async signInWithPassword() { return { data: { session: FAKE_SESSION }, error: null }; },
      async signOut() { return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    },

    /* 供測試與除錯 */
    __tables: () => state.tables,
    __rows: name => rowsOf(name),
    __flush: () => save(state)
  };
}

/** 清掉本機資料庫 */
export function clearLocalStore() {
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* 沒有 sessionStorage 就算了 */ }
}

/* ------------------------------------------------------------------ */
/* 儲存                                                                */
/* ------------------------------------------------------------------ */

function load() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || !v.tables) return null;
    if (typeof v.serial !== 'number') v.serial = SERIAL_BASE;
    return v;
  } catch {
    return null;      // 資料壞了就當作沒有，重新開始比丟錯誤好
  }
}

function save(state) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* 超過配額時先丟掉舊課堂再試一次。試用模式的舊考卷不重要，
     * 保住當前這一張能繼續作答才重要。 */
    try {
      trim(state);
      sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* 還是存不下就只留在記憶體，重新載入頁面才會失去進度 */
    }
  }
}

/**
 * 只留最近八堂課與其作答紀錄。佔空間的是題目快照，所以只丟這兩張表；
 * 積分流水每列很小而且關係到累積積分不能倒退，一律保留。
 */
function trim(state) {
  const lessons = state.tables.lessons || [];
  if (lessons.length <= 8) return;

  const keep = lessons.slice(-8);
  const ids = new Set(keep.map(l => l.id));
  state.tables.lessons = keep;
  state.tables.attempts = (state.tables.attempts || []).filter(a => ids.has(a.lesson_id));
}

const arr = v => (Array.isArray(v) ? v : [v]);
const clone = v => JSON.parse(JSON.stringify(v));
