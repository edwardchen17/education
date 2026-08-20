/* ===== screens/gate.js — 家庭密碼 =====
 * 對應需求 1.1、1.4、1.5：通過驗證前不顯示任何學生資料。
 */

import { escapeHtml } from '../core.js';
import { APP_VERSION } from '../config.js';
import * as Auth from '../auth.js';

export default {
  render(host) {
    host.innerHTML = `
      <div class="gate-wrap">
        <div class="card gate-card">
          <div class="gate-title">練習系統</div>
          <div class="t-sm t-dim" style="margin-bottom:16px">
            這台裝置第一次使用，請輸入家庭密碼。之後就不用再輸入了。
          </div>

          <label for="pw">家庭密碼</label>
          <input id="pw" type="password" autocomplete="current-password" enterkeyhint="go">

          <div class="row" style="margin-top:14px">
            <button id="go" class="btn-primary grow">進入</button>
          </div>

          <div class="row" style="margin-top:10px">
            <button id="help" class="grow t-dim">第一次來？看怎麼用</button>
          </div>

          <div id="msg" class="t-sm" style="margin-top:12px"></div>
          <div class="build-tag">版本 ${APP_VERSION}</div>
        </div>
      </div>`;

    host.querySelector('#help').onclick = () => { location.hash = '#/help'; };

    const pw = host.querySelector('#pw');
    const msg = host.querySelector('#msg');
    const go = host.querySelector('#go');

    const submit = async () => {
      if (!pw.value) { msg.innerHTML = '<span class="t-warn">請輸入密碼</span>'; return; }
      go.disabled = true;
      msg.innerHTML = '<span class="t-dim">確認中…</span>';
      try {
        await Auth.signIn(pw.value);
        pw.value = '';
        location.hash = '#/students';
      } catch (err) {
        go.disabled = false;
        msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
        pw.select();
      }
    };

    go.onclick = submit;
    pw.onkeydown = e => { if (e.key === 'Enter') submit(); };
    pw.focus();
  }
};
