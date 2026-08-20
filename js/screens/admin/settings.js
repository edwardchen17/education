/* ===== screens/admin/settings.js — 系統設定（任務 12.5） =====
 * 對應需求 3.5、8.4：暑假日期範圍、平日與暑假每日堂數、科目輪替順序、目標時長。
 */

import { escapeHtml, todayTW, isSummer } from '../../core.js';
import { LEVELS } from '../../config.js';
import { subjectsFor, DEFAULT_ROTATION, subjectLabel } from '../../config/subjects.js';
import { LESSON } from '../../config/scoring.js';
import * as Auth from '../../auth.js';
import * as DB from '../../db.js';

export default { render };

async function render(host) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>載入設定</div></div>`;

  const cfg = await DB.settings.get();
  const today = todayTW();
  const inSummer = isSummer(today, cfg.summer_start, cfg.summer_end);

  host.innerHTML = `
    <div class="card">
      <div class="card-title">系統設定</div>
      <div class="t-sm t-dim">
        今天是 ${escapeHtml(today)}，目前${inSummer ? '<b class="t-warn">在暑假範圍內</b>' : '不在暑假範圍內'}，
        所以每天排 <b>${inSummer ? cfg.lessons_summer : cfg.lessons_weekday}</b> 堂。
      </div>
    </div>

    <div class="card">
      <div class="card-title">課堂</div>
      <div class="stack">
        <div class="grid-2">
          <div>
            <label for="ss">暑假開始（月-日）</label>
            <input id="ss" value="${escapeHtml(cfg.summer_start)}" placeholder="07-01" maxlength="5">
          </div>
          <div>
            <label for="se">暑假結束（月-日）</label>
            <input id="se" value="${escapeHtml(cfg.summer_end)}" placeholder="08-31" maxlength="5">
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label for="lw">平日每天幾堂</label>
            <input id="lw" type="number" min="0" max="4" value="${cfg.lessons_weekday}">
          </div>
          <div>
            <label for="ls">暑假每天幾堂</label>
            <input id="ls" type="number" min="0" max="4" value="${cfg.lessons_summer}">
          </div>
        </div>
        <div>
          <label for="tm">每堂目標時間（分鐘，${LESSON.minMinutes} 到 ${LESSON.maxMinutes}）</label>
          <input id="tm" type="number" min="${LESSON.minMinutes}" max="${LESSON.maxMinutes}"
                 value="${cfg.target_minutes}">
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">科目輪替順序</div>
      <div class="t-sm t-dim" style="margin-bottom:10px">
        系統會依這個順序每天推進一格，並自動避開前一天上過的科目。
        留空表示使用預設順序。目前只有數學與國文有題庫，排到其他科目時會自動跳過。
      </div>
      ${Object.values(LEVELS).map(l => rotationBox(l, cfg)).join('')}
    </div>

    <div class="card">
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button id="save" class="btn-primary">儲存設定</button>
        <button id="reset">恢復預設</button>
        <span class="t-sm" id="msg"></span>
      </div>
    </div>`;

  bind(host, cfg, () => render(host));
}

function rotationBox(level, cfg) {
  const current = (cfg.rotation && cfg.rotation[level.code]) || DEFAULT_ROTATION[level.code] || [];
  const subjects = subjectsFor(level.code);
  return `
    <div style="margin-bottom:14px">
      <label>${escapeHtml(level.label)}</label>
      <input data-rot="${level.code}" value="${escapeHtml(current.join(' '))}"
             placeholder="${escapeHtml((DEFAULT_ROTATION[level.code] || []).join(' '))}">
      <div class="t-dim t-sm" style="margin-top:4px">
        可用代號：${subjects.map(s => `<code>${s.code}</code>（${escapeHtml(s.label)}）`).join('、')}
      </div>
    </div>`;
}

function bind(host, cfg, reload) {
  const $ = id => host.querySelector('#' + id);
  const msg = $('msg');

  host.querySelectorAll('input').forEach(el => el.oninput = () => Auth.touchAdmin());

  $('save').onclick = async () => {
    Auth.touchAdmin();

    const md = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const ss = $('ss').value.trim();
    const se = $('se').value.trim();
    if (!md.test(ss) || !md.test(se)) {
      msg.innerHTML = '<span class="t-bad">暑假日期要寫成 07-01 這種格式</span>';
      return;
    }

    const lw = clampInt($('lw').value, 0, 4);
    const ls = clampInt($('ls').value, 0, 4);
    const tm = clampInt($('tm').value, LESSON.minMinutes, LESSON.maxMinutes);

    /* 輪替序：只接受該程度真正存在的科目代號 */
    const rotation = {};
    for (const level of Object.values(LEVELS)) {
      const el = host.querySelector(`[data-rot="${level.code}"]`);
      const valid = new Set(subjectsFor(level.code).map(s => s.code));
      const parts = el.value.split(/[\s,、]+/).map(x => x.trim()).filter(Boolean);
      const bad = parts.filter(p => !valid.has(p));
      if (bad.length) {
        msg.innerHTML = `<span class="t-bad">${escapeHtml(level.label)} 有不認識的科目代號：${
          escapeHtml(bad.join('、'))}</span>`;
        return;
      }
      if (parts.length) rotation[level.code] = parts;
    }

    msg.innerHTML = '<span class="t-dim">儲存中…</span>';
    try {
      await DB.settings.update({
        summer_start: ss, summer_end: se,
        lessons_weekday: lw, lessons_summer: ls,
        target_minutes: tm, rotation
      });
      msg.innerHTML = '<span class="t-ok">已儲存。新設定會在下一次排課時生效，已建立的課堂不受影響。</span>';
      setTimeout(reload, 1500);
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };

  $('reset').onclick = async () => {
    Auth.touchAdmin();
    if (!confirm('恢復成預設設定？暑假 07-01 至 08-31、平日 1 堂、暑假 2 堂、每堂 25 分鐘。')) return;
    try {
      await DB.settings.update({
        summer_start: '07-01', summer_end: '08-31',
        lessons_weekday: 1, lessons_summer: 2,
        target_minutes: LESSON.targetMinutes, rotation: {}
      });
      reload();
    } catch (err) {
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
