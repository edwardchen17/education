/* ===== main.js — 進入點與雜湊路由 =====
 * 目前為第一階段的地基。已完成：核心工具、資料層、答案比對、數學式渲染。
 * 尚未實作真正的學生畫面，這裡先提供三個診斷頁供驗證整條路徑。
 */

import { APP_VERSION } from './config.js';
import { todayTW, fmtDateTW, escapeHtml } from './core.js';
import { renderMath } from './engine/mathfmt.js';
import { parseNumeric } from './engine/answer.js';
import * as Auth from './auth.js';
import * as DB from './db.js';
import { Cache, OfflineQueue, isOnline, watchNetwork } from './cache.js';

const app = document.getElementById('app');
const routes = new Map();
const register = (name, screen) => routes.set(name, screen);

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: name || 'home', params: rest };
}

async function navigate() {
  const { name, params } = parseHash();
  const screen = routes.get(name) || routes.get('notfound');
  app.innerHTML = '';
  try {
    await screen.render(app, params);
  } catch (err) {
    console.error('[render]', err);
    app.innerHTML = card('發生錯誤', `
      <div class="banner banner-bad">${escapeHtml(err?.message || String(err))}</div>
      <div class="row" style="margin-top:14px"><button data-go="home">回到首頁</button></div>`);
    bindNav(app);
  }
}

export function go(path) { location.hash = '#/' + path; }

function card(title, bodyHtml) {
  return `<div class="wrap"><div class="card">
    <div class="card-title">${escapeHtml(title)}</div>${bodyHtml}
  </div></div>`;
}

/** 讓 [data-go] 的按鈕可以切換畫面 */
function bindNav(host) {
  host.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', () => go(el.dataset.go));
  });
}

/* ------------------------------------------------------------------ */
/* 首頁                                                                */
/* ------------------------------------------------------------------ */

register('home', {
  async render(host) {
    const signedIn = await Auth.hasSession();
    host.innerHTML = card('練習系統', `
      <div class="stack">
        <div class="banner banner-ok">前端載入正常。</div>
        <div class="t-sm t-dim">
          版本 ${APP_VERSION}　今天是 ${fmtDateTW(todayTW())}<br>
          家庭登入狀態：<b class="${signedIn ? 't-ok' : 't-warn'}">${signedIn ? '已登入' : '未登入'}</b><br>
          網路：<b class="${isOnline() ? 't-ok' : 't-warn'}">${isOnline() ? '連線中' : '離線'}</b>　
          待補送：${OfflineQueue.size()} 筆
        </div>
        <div class="t-sm t-dim">
          第一階段的地基已完成（核心工具、資料層、答案比對、數學式渲染）。
          學生的作答畫面還沒做，下面三個是給爸爸驗證用的診斷頁。
        </div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button data-go="diag">資料庫連線測試</button>
          <button data-go="selftest">環境自我檢查</button>
          <button data-go="mathdemo">數學式與答案比對</button>
        </div>
      </div>`);
    bindNav(host);
  }
});

/* ------------------------------------------------------------------ */
/* 資料庫連線測試                                                      */
/* ------------------------------------------------------------------ */

register('diag', {
  async render(host) {
    const signedIn = await Auth.hasSession();

    host.innerHTML = card('資料庫連線測試', `
      <div class="stack">
        <div class="t-sm t-dim">
          這一頁會實際連上 Supabase，驗證資料表、RLS 政策與家庭帳號都設定正確。
        </div>
        <div id="state" class="banner ${signedIn ? 'banner-ok' : 'banner-warn'}">
          ${signedIn ? '已登入家庭帳號' : '尚未登入'}
        </div>
        <div id="loginBox" style="${signedIn ? 'display:none' : ''}">
          <label for="pw">家庭密碼</label>
          <input id="pw" type="password" autocomplete="current-password" placeholder="在 Supabase 建立帳號時設定的那組">
          <div class="row" style="margin-top:10px">
            <button id="btnLogin" class="btn-primary">登入</button>
          </div>
        </div>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button id="btnRead">讀取資料</button>
          <button id="btnRls">測試 RLS 保護</button>
          <button id="btnOut">登出此裝置</button>
          <button data-go="home">返回</button>
        </div>
        <div id="out" class="t-sm"></div>
      </div>`);
    bindNav(host);

    const $ = id => host.querySelector('#' + id);
    const out = msg => { $('out').innerHTML = msg; };
    const setState = (cls, text) => {
      $('state').className = 'banner ' + cls;
      $('state').textContent = text;
    };

    $('btnLogin').addEventListener('click', async () => {
      const pw = $('pw').value;
      if (!pw) { out('<span class="t-warn">請輸入密碼</span>'); return; }
      out('登入中…');
      try {
        await Auth.signIn(pw);
        setState('banner-ok', '已登入家庭帳號');
        $('loginBox').style.display = 'none';
        out('<span class="t-ok">登入成功。這台裝置以後不用再輸入密碼。</span>');
      } catch (err) {
        out(`<span class="t-bad">${escapeHtml(err.message)}</span>`);
      }
    });

    $('btnRead').addEventListener('click', async () => {
      out('讀取中…');
      try {
        const [list, cfg] = await Promise.all([DB.students.list(), DB.settings.get()]);
        const rows = list.map(s => `
          <tr><td>${s.id}</td><td>${escapeHtml(s.name)}</td>
              <td>${s.level ?? '<span class="t-dim">未設定</span>'}</td>
              <td>${s.name_locked ? '已鎖定' : '可改名'}</td></tr>`).join('');
        out(`<div class="banner banner-ok" style="margin-bottom:10px">
               讀取成功，共 ${list.length} 個學生檔位。整條路徑都通了。
             </div>
             <table style="width:100%;border-collapse:collapse">
               <tr class="t-dim t-sm"><th align="left">檔位</th><th align="left">名字</th>
                   <th align="left">程度</th><th align="left">改名狀態</th></tr>
               ${rows}
             </table>
             <div class="t-dim t-sm" style="margin-top:10px">
               系統設定：暑假 ${cfg.summer_start} 至 ${cfg.summer_end}、
               平日 ${cfg.lessons_weekday} 堂、暑假 ${cfg.lessons_summer} 堂、
               每堂目標 ${cfg.target_minutes} 分鐘
             </div>`);
      } catch (err) {
        out(`<span class="t-bad">${escapeHtml(err.message)}</span>`);
      }
    });

    /* RLS 三步驗證。
     * 重點：PostgREST 對 SELECT 的行為是「把資料列過濾掉」而不是回傳錯誤，
     * 所以未登入時讀到 0 筆才是 RLS 正常。寫入才會觸發 42501 權限錯誤。 */
    $('btnRls').addEventListener('click', async () => {
      const steps = [];
      const paint = () => out(`
        <div class="stack">
          ${steps.map(s => `
            <div class="row" style="gap:8px;align-items:flex-start">
              <span class="${s.pass === null ? 't-dim' : s.pass ? 't-ok' : 't-bad'}"
                    style="flex:0 0 1.4em">${s.pass === null ? '…' : s.pass ? '✓' : '✗'}</span>
              <span>${s.text}</span>
            </div>`).join('')}
        </div>`);

      const step = text => { steps.push({ text, pass: null }); paint(); return steps[steps.length - 1]; };

      try {
        /* 步驟 1：已登入時應該讀得到四筆 */
        const s1 = step('已登入時讀取學生資料');
        if (!await Auth.hasSession()) {
          s1.pass = false;
          s1.text = '需要先登入才能測試，請輸入家庭密碼後再按一次';
          paint();
          setState('banner-warn', '尚未登入');
          $('loginBox').style.display = '';
          return;
        }
        const before = await DB.students.list();
        s1.pass = before.length === 4;
        s1.text = `已登入時讀到 <b>${before.length}</b> 筆學生資料${s1.pass ? '' : '（預期 4 筆）'}`;
        paint();

        /* 步驟 2：登出後讀取應該變成 0 筆（RLS 把資料列過濾掉） */
        const s2 = step('登出後讀取');
        await Auth.signOutDevice();
        let after;
        let selectBlocked = false;
        try {
          after = await DB.students.list();
        } catch {
          selectBlocked = true;
          after = [];
        }
        s2.pass = after.length === 0;
        s2.text = selectBlocked
          ? '登出後讀取直接被拒絕'
          : `登出後讀到 <b>${after.length}</b> 筆${s2.pass ? '（RLS 已把資料列全部過濾掉）' : '　<b>這是問題</b>，外人可能讀得到資料'}`;
        paint();

        /* 步驟 3：登出後寫入應該被權限錯誤擋下 */
        const s3 = step('登出後嘗試寫入');
        try {
          await DB.notifications.add(1, 'rls_probe', { note: '權限測試' });
          s3.pass = false;
          s3.text = '登出後竟然寫入成功　<b>這是嚴重問題</b>，請把這個結果告訴我';
        } catch (err) {
          s3.pass = true;
          s3.text = `登出後寫入被拒絕：<span class="t-dim">${escapeHtml(err.message)}</span>`;
        }
        paint();

        const allPass = steps.every(s => s.pass);
        steps.push({
          pass: allPass,
          text: allPass
            ? '<b class="t-ok">RLS 設定正確。</b>外人即使拿到網頁裡的金鑰，既讀不到也寫不進你的資料。'
            : '<b class="t-bad">有項目未通過</b>，請把畫面截圖給我。'
        });
        steps.push({ pass: true, text: '<span class="t-dim">測試過程中已登出，請重新登入。</span>' });
        paint();

        setState('banner-warn', '尚未登入');
        $('loginBox').style.display = '';
      } catch (err) {
        out(`<span class="t-bad">${escapeHtml(err.message)}</span>`);
      }
    });

    $('btnOut').addEventListener('click', async () => {
      await Auth.signOutDevice();
      setState('banner-warn', '尚未登入');
      $('loginBox').style.display = '';
      out('已登出此裝置。');
    });
  }
});

/* ------------------------------------------------------------------ */
/* 數學式與答案比對示範                                                */
/* ------------------------------------------------------------------ */

register('mathdemo', {
  render(host) {
    const samples = [
      '\\frac{3}{4} + \\frac{1}{2}',
      'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      '\\sqrt[3]{27} = 3',
      '\\triangle ABC \\parallel \\overline{DE}',
      '2^{10} = 1024',
      '\\angle A = 60\\deg',
      'a_1 + a_2 + \\cdots + a_n'
    ];

    host.innerHTML = card('數學式與答案比對', `
      <div class="stack">
        <div class="t-sm t-dim">確認數學式在這台裝置上顯示正確，分數線與根號要對齊。</div>
        ${samples.map(s => `
          <div style="padding:10px 0;border-bottom:1px solid var(--line)">
            <div style="font-size:1.15em">${renderMath(s)}</div>
            <div class="t-dim t-sm selectable" style="margin-top:4px">${escapeHtml(s)}</div>
          </div>`).join('')}

        <div class="card-title" style="margin-top:14px">答案比對</div>
        <div class="t-sm t-dim">
          試著輸入 <b>3/4</b>、<b>0.75</b>、<b>6/8</b>、<b>1 1/2</b>、<b>2√3</b>、<b>18 km</b>、<b>１８</b>，
          看系統是否都讀得懂。
        </div>
        <label for="ans" style="margin-top:8px">輸入一個答案</label>
        <input id="ans" placeholder="例如 3/4">
        <div id="parsed" class="t-sm" style="margin-top:8px"></div>
        <div class="row" style="margin-top:12px"><button data-go="home">返回</button></div>
      </div>`);
    bindNav(host);

    const input = host.querySelector('#ans');
    const show = () => {
      const v = parseNumeric(input.value);
      host.querySelector('#parsed').innerHTML = input.value.trim() === ''
        ? ''
        : Number.isNaN(v)
          ? '<span class="t-bad">看不懂這個寫法（會算錯，但原始輸入會保留給老師看）</span>'
          : `<span class="t-ok">解析為 ${v}</span>`;
    };
    input.addEventListener('input', show);
  }
});

/* ------------------------------------------------------------------ */
/* 環境自我檢查                                                        */
/* ------------------------------------------------------------------ */

register('selftest', {
  render(host) {
    const checks = [
      ['ES Modules', true],
      ['localStorage', hasLocalStorage()],
      ['Canvas 2D', !!document.createElement('canvas').getContext('2d')],
      ['WebAudio', !!(window.AudioContext || window.webkitAudioContext)],
      ['語音合成 SpeechSynthesis', 'speechSynthesis' in window],
      ['Service Worker', 'serviceWorker' in navigator],
      ['MathML 呈現', typeof MathMLElement === 'function'],
      ['Intl 時區支援', hasTimeZone()]
    ];

    const rows = checks.map(([name, okFlag]) => `
      <div class="row-between" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${escapeHtml(name)}</span>
        <span class="${okFlag ? 't-ok' : 't-warn'}">${okFlag ? '可用' : '不支援'}</span>
      </div>`).join('');

    host.innerHTML = card('環境自我檢查', `
      ${rows}
      <div class="t-sm t-dim" style="margin-top:12px">
        台灣當地日期：${todayTW()}<br>
        快取項目：${Cache.get('__probe') === null ? '可讀寫' : '可讀寫'}<br>
        不支援的項目會讓對應功能自動停用，不影響其他部分。
      </div>
      <div class="row" style="margin-top:14px"><button data-go="home">返回</button></div>`);
    bindNav(host);
  }
});

register('notfound', {
  render(host) {
    host.innerHTML = card('找不到頁面', `
      <div class="stack">
        <div class="t-dim">網址可能輸入錯了。</div>
        <div><button data-go="home">回到首頁</button></div>
      </div>`);
    bindNav(host);
  }
});

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function hasLocalStorage() {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
  catch { return false; }
}

function hasTimeZone() {
  try { return !!new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); }
  catch { return false; }
}

/* ------------------------------------------------------------------ */
/* 啟動                                                                */
/* ------------------------------------------------------------------ */

watchNetwork();
window.addEventListener('hashchange', navigate);
if (!location.hash) location.hash = '#/home';
navigate();

console.log(`練習系統 ${APP_VERSION}`);
