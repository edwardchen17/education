/* ===== config.js — 連線與全域常數 =====
 *
 * 這裡的 Supabase publishable key 是設計上可公開的金鑰，放進公開 repo 沒有問題。
 * 資料庫的 RLS 政策設定為「只有登入家庭帳號的連線才能讀寫」，
 * 因此光有這組 key 而沒有登入的請求，會被資料庫直接拒絕。
 *
 * 絕對不要把 secret key（sb_secret_...）放進這個檔案。
 */

export const SUPABASE_URL = 'https://wudmpbrwmkzjvrngtadt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_A0BuoT18ysM0Z4Fo7v-WxQ_MsM7s69c';

/* supabase-js 釘死版本，避免 CDN 自動跳版導致行為改變 */
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

/* 家庭帳號的 email。密碼由使用者輸入，程式不保存。
 * 使用不存在的網域是刻意的：這個字串會出現在公開 repo，
 * 用真實信箱會被爬蟲撿去發垃圾信。忘記密碼可在 Supabase 後台重設。 */
export const FAMILY_EMAIL = 'family@chen.local';

/* 管理者密碼。這是前端驗證，可以被繞過，僅用於避免小孩誤入老師介面，
 * 不是安全邊界。這是刻意的設計取捨。 */
export const ADMIN_PASSWORD = '29683816';

/* 管理者介面閒置多久自動退出（毫秒） */
export const ADMIN_IDLE_MS = 15 * 60 * 1000;

/* 程度代碼與顯示名稱 */
export const LEVELS = {
  g8: { code: 'g8', label: '國二上學期', short: '國二' },
  g5: { code: 'g5', label: '小五上學期', short: '小五' }
};

/* 每次部署都要往上調。畫面右下角會顯示這個號碼，
 * 如果看到的號碼不是最新的，代表瀏覽器還在用快取，需要強制重新載入。 */
export const APP_VERSION = '0.4.0';
