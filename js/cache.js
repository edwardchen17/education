/* ===== cache.js — 本機快取、作答暫存、離線佇列 =====
 *
 * 三件事：
 *   Cache        題庫與設定的快取，斷線時仍能作答
 *   Draft        作答中的答案暫存，關掉頁面還能續答
 *   OfflineQueue 離線期間的寫入操作排隊，恢復連線後依序補送
 */

const PREFIX = 'edu.';
const K_QUEUE = PREFIX + 'queue';
const K_CACHE = PREFIX + 'cache.';
const K_DRAFT = PREFIX + 'draft.';

/* ------------------------------------------------------------------ */
/* 低階讀寫                                                            */
/* ------------------------------------------------------------------ */

function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // 配額滿了：清掉最舊的快取再試一次
    if (isQuotaError(err)) {
      pruneCache();
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    }
    return false;
  }
}

function isQuotaError(err) {
  return err && (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014);
}

function keysWithPrefix(p) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(p)) out.push(k);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cache — 帶有效期的資料快取                                          */
/* ------------------------------------------------------------------ */

export const Cache = {
  /** 寫入快取。ttlMs 省略表示永不過期（題庫這類跟著版本走的資料）。 */
  set(name, value, ttlMs) {
    return writeJSON(K_CACHE + name, {
      v: value,
      at: Date.now(),
      exp: ttlMs ? Date.now() + ttlMs : null
    });
  },

  /** 讀取快取，過期或不存在回傳 null。
   *  刻意不刪除過期資料：斷線時 getStale 還要靠它撐著。
   *  真正的清理交給配額不足時的 pruneCache。 */
  get(name) {
    const rec = readJSON(K_CACHE + name);
    if (!rec) return null;
    if (rec.exp && Date.now() > rec.exp) return null;
    return rec.v;
  },

  /** 即使過期也讀出來。斷線時寧可用舊資料也不要沒資料。 */
  getStale(name) {
    const rec = readJSON(K_CACHE + name);
    return rec ? rec.v : null;
  },

  has(name) { return Cache.get(name) !== null; },

  remove(name) { localStorage.removeItem(K_CACHE + name); },

  clear() { keysWithPrefix(K_CACHE).forEach(k => localStorage.removeItem(k)); },

  /**
   * 先讀快取，沒有才去抓。抓失敗時退回過期的舊快取。
   * @param {string} name
   * @param {Function} loader 回傳 Promise 的取資料函式
   * @param {number} [ttlMs]
   */
  async wrap(name, loader, ttlMs) {
    const hit = Cache.get(name);
    if (hit !== null) return hit;
    try {
      const fresh = await loader();
      Cache.set(name, fresh, ttlMs);
      return fresh;
    } catch (err) {
      const stale = Cache.getStale(name);
      if (stale !== null) return stale;
      throw err;
    }
  }
};

/** 快取滿了的時候，丟掉最舊的一半 */
function pruneCache() {
  const items = keysWithPrefix(K_CACHE)
    .map(k => ({ k, at: readJSON(k)?.at || 0 }))
    .sort((a, b) => a.at - b.at);
  items.slice(0, Math.max(1, Math.floor(items.length / 2)))
       .forEach(i => localStorage.removeItem(i.k));
}

/* ------------------------------------------------------------------ */
/* Draft — 作答暫存                                                    */
/* ------------------------------------------------------------------ */

export const Draft = {
  /** 存下這堂課目前的作答狀態 */
  save(lessonId, data) {
    return writeJSON(K_DRAFT + lessonId, { ...data, savedAt: Date.now() });
  },

  load(lessonId) {
    return readJSON(K_DRAFT + lessonId);
  },

  clear(lessonId) {
    localStorage.removeItem(K_DRAFT + lessonId);
  },

  /** 列出所有未清除的暫存，用於提示「你有一堂課沒做完」 */
  list() {
    return keysWithPrefix(K_DRAFT).map(k => ({
      lessonId: Number(k.slice(K_DRAFT.length)),
      data: readJSON(k)
    }));
  }
};

/* ------------------------------------------------------------------ */
/* OfflineQueue — 離線寫入佇列                                         */
/* ------------------------------------------------------------------ */

export const OfflineQueue = {
  list() { return readJSON(K_QUEUE, []); },

  size() { return OfflineQueue.list().length; },

  /** 排入一筆待補送的操作 */
  push(op, payload) {
    const q = OfflineQueue.list();
    q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, op, payload, at: Date.now() });
    writeJSON(K_QUEUE, q);
    return q.length;
  },

  clear() { writeJSON(K_QUEUE, []); },

  /**
   * 依序重放佇列。成功的移除，遇到第一個失敗就停下來保留順序。
   * @param {Record<string, (payload:any)=>Promise<any>>} handlers
   * @returns {Promise<{sent:number, left:number, error:Error|null}>}
   */
  async flush(handlers) {
    let q = OfflineQueue.list();
    let sent = 0;
    let error = null;

    while (q.length) {
      const item = q[0];
      const handler = handlers[item.op];

      if (!handler) {
        // 沒有對應處理器的項目直接丟棄，避免永遠卡住佇列
        console.warn('[queue] 未知的操作，已丟棄：', item.op);
        q.shift();
        writeJSON(K_QUEUE, q);
        continue;
      }

      try {
        await handler(item.payload);
        q.shift();
        writeJSON(K_QUEUE, q);
        sent++;
      } catch (err) {
        error = err;
        break;
      }
    }

    return { sent, left: q.length, error };
  }
};

/* ------------------------------------------------------------------ */
/* 連線狀態                                                            */
/* ------------------------------------------------------------------ */

const netListeners = new Set();

/** 訂閱連線狀態變化 */
export function onNetworkChange(fn) {
  netListeners.add(fn);
  return () => netListeners.delete(fn);
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/** 在瀏覽器啟動時掛上 online / offline 事件 */
export function watchNetwork() {
  if (typeof window === 'undefined' || !window.addEventListener) return;
  const fire = () => netListeners.forEach(fn => {
    try { fn(isOnline()); } catch (e) { console.error(e); }
  });
  window.addEventListener('online', fire);
  window.addEventListener('offline', fire);
}
