/* ===== screens/demo.js — 訪客試用首頁 =====
 *
 * 這是訪客連結（#/demo）唯一的入口畫面。刻意只留一個帳號、一個科目，
 * 讓朋友點進來就能直接做題，不必先理解整個系統。
 *
 * 與正式流程的差別：
 *   · 不限次數，每按一次就是一張全新的考卷
 *   · 難度可自己切換，不做自動升降
 *   · 資料只存在這個瀏覽器分頁，關掉就沒了
 */

import { escapeHtml, fmtDuration, todayTW } from '../core.js';
import { APP_VERSION } from '../config.js';
import { DIFFICULTY_LABEL } from '../config/scoring.js';
import { createPracticeLesson } from '../engine/schedule.js';
import { Draft } from '../cache.js';
import * as DB from '../db.js';
import {
  DEMO_STUDENT_ID, DEMO_NAME, DEMO_SUBJECT, DEMO_DEFAULT_DIFFICULTY,
  isDemo, enterDemo, exitDemo, resetDemo
} from '../demo.js';

const CHOICES = ['advanced', 'gifted'];

export default {
  async render(host) {
    /* 直接貼連結進來的人，這裡才是真正進入試用模式的地方 */
    if (!isDemo()) enterDemo();

    host.innerHTML = `<div class="loading"><div class="spinner"></div><div>準備考卷</div></div>`;

    let student, papers, total;
    try {
      student = await DB.students.get(DEMO_STUDENT_ID);
      papers = await DB.lessons.history(DEMO_STUDENT_ID, { limit: 20 });
      total = await DB.points.total(DEMO_STUDENT_ID);
    } catch (err) {
      host.innerHTML = errorCard(err.message);
      bind(host);
      return;
    }

    const state = await DB.subjectState.get(DEMO_STUDENT_ID, DEMO_SUBJECT);
    const difficulty = state?.difficulty || DEMO_DEFAULT_DIFFICULTY;

    const done = papers.filter(l => l.status === 'submitted' || l.status === 'graded');
    const unfinished = papers.find(l => l.status === 'pending' || l.status === 'active');

    host.innerHTML = `
      <div class="wrap">
        <div class="card hero">
          <div class="row-between" style="flex-wrap:wrap;gap:10px">
            <div>
              <div class="hero-name">${escapeHtml(student?.name || DEMO_NAME)}</div>
              <div class="t-sm t-dim">國二數學　${DIFFICULTY_LABEL[difficulty]}　試用中</div>
            </div>
            <div class="hero-stats">
              <div>
                <div class="t-sm t-dim">做過</div>
                <b>${done.length}</b>
                <span class="t-sm t-dim">張</span>
              </div>
              <div>
                <div class="t-sm t-dim">累積積分</div>
                <b class="t-gold">${Math.round(total)}</b>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">這是什麼</div>
          <div class="t-sm t-dim" style="line-height:1.85">
            一份自動出題、自動批改的國二數學考卷。題目是程式即時生成的，
            所以<b class="t-ok">每次按下開始都是全新的一張</b>，想做幾張都可以。
            寫的時候如果卡住，可以打開「看解題邏輯」，
            它會逐步告訴你怎麼想，選擇題還會說明每個選項為什麼不成立。
            交卷後馬上就有分數和逐題檢討。
          </div>
          <div class="t-sm t-warn" style="margin-top:10px">
            試用的作答只存在這個瀏覽器分頁裡，關掉分頁就會清掉，不會上傳到任何地方。
          </div>
        </div>

        <div class="card">
          <div class="card-title">選難度</div>
          <div class="row" style="flex-wrap:wrap;gap:8px">
            ${CHOICES.map(d => `
              <button class="diff-btn ${d === difficulty ? 'on' : ''}" data-diff="${d}">
                ${DIFFICULTY_LABEL[d]}
              </button>`).join('')}
          </div>
          <div class="t-sm t-dim" style="margin-top:8px">
            進階是一般國二的加深程度，資優會出現需要多轉幾個彎的題目，配分也比較高。
          </div>
        </div>

        <div class="card">
          ${unfinished ? `
            <div class="banner banner-warn" style="margin-bottom:12px">
              你有一張還沒寫完的考卷。
            </div>
            <div class="row" style="flex-wrap:wrap;gap:8px">
              <button class="btn-primary" data-open="${unfinished.id}">接著寫完</button>
              <button id="newPaper">不寫了，換一張新的</button>
            </div>` : `
            <div class="row" style="flex-wrap:wrap;gap:8px">
              <button id="newPaper" class="btn-primary grow">開始一張新的考卷</button>
            </div>`}
          <div id="msg" class="t-sm" style="margin-top:10px"></div>
        </div>

        ${done.length ? `
          <div class="card">
            <div class="card-title">做過的考卷</div>
            ${done.map(paperRow).join('')}
          </div>` : ''}

        <div class="card">
          <div class="row" style="flex-wrap:wrap;gap:8px">
            <button data-go="help">怎麼用</button>
            ${done.length ? '<button id="reset" class="t-dim">清掉紀錄重新開始</button>' : ''}
            <span class="grow"></span>
            <button id="leave" class="t-dim">離開試用</button>
          </div>
          <div class="build-tag">版本 ${APP_VERSION}　試用模式</div>
        </div>
      </div>`;

    bind(host, { student, difficulty });
  }
};

/* ------------------------------------------------------------------ */

function paperRow(l) {
  const earned = Number(l.score_earned) || 0;
  const max = Number(l.score_max) || 0;
  const pct = max > 0 ? Math.round(earned / max * 100) : 0;
  const cls = pct >= 80 ? 't-ok' : pct >= 60 ? 't-gold' : 't-bad';

  return `
    <button class="paper-row" data-result="${l.id}">
      <span class="grow" style="text-align:left">
        <span>${DIFFICULTY_LABEL[l.plan?.difficulty] || ''}　${l.plan?.items?.length || 0} 題</span>
        <span class="t-sm t-dim" style="display:block">
          ${fmtDuration(l.timer_seconds)}　第 ${l.slot_of_day} 張
        </span>
      </span>
      <b class="${cls}">${Math.round(earned * 10) / 10} / ${Math.round(max * 10) / 10}</b>
      <span class="t-sm t-dim">${pct}%</span>
    </button>`;
}

function errorCard(message) {
  return `
    <div class="wrap"><div class="card">
      <div class="card-title">試用模式啟動失敗</div>
      <div class="banner banner-bad">${escapeHtml(message)}</div>
      <div class="row" style="margin-top:14px">
        <button onclick="location.reload()">重新載入</button>
      </div>
    </div></div>`;
}

/* ------------------------------------------------------------------ */

function bind(host, ctx = {}) {
  host.querySelectorAll('[data-go]').forEach(b =>
    b.onclick = () => { location.hash = '#/' + b.dataset.go; });

  host.querySelectorAll('[data-open]').forEach(b =>
    b.onclick = () => { location.hash = '#/lesson/' + b.dataset.open; });

  host.querySelectorAll('[data-result]').forEach(b =>
    b.onclick = () => { location.hash = '#/result/' + b.dataset.result; });

  /* 切難度：只改狀態，下一張考卷才會套用 */
  host.querySelectorAll('[data-diff]').forEach(b => b.onclick = async () => {
    await DB.subjectState.upsert({
      student_id: DEMO_STUDENT_ID,
      subject: DEMO_SUBJECT,
      difficulty: b.dataset.diff,
      locked: true,
      recent: []
    });
    location.reload();
  });

  const msg = host.querySelector('#msg');

  const newPaper = host.querySelector('#newPaper');
  if (newPaper) newPaper.onclick = async () => {
    newPaper.disabled = true;
    msg.innerHTML = '<span class="t-dim">出題中…</span>';
    try {
      /* 換新卷時把舊卷的暫存清掉，免得「還沒寫完」一直跳出來 */
      const old = await DB.lessons.history(DEMO_STUDENT_ID, { limit: 20 });
      old.filter(l => l.status === 'pending' || l.status === 'active')
         .forEach(l => Draft.clear(l.id));

      const lesson = await createPracticeLesson({
        student: ctx.student,
        subject: DEMO_SUBJECT,
        difficulty: ctx.difficulty,
        date: todayTW()
      });
      location.hash = '#/lesson/' + lesson.id;
    } catch (err) {
      newPaper.disabled = false;
      msg.innerHTML = `<span class="t-bad">${escapeHtml(err.message)}</span>`;
    }
  };

  const reset = host.querySelector('#reset');
  if (reset) reset.onclick = () => {
    if (!confirm('會清掉這次試用做過的所有考卷與積分。要繼續嗎？')) return;
    Draft.list().forEach(d => Draft.clear(d.lessonId));
    resetDemo();
    location.reload();
  };

  const leave = host.querySelector('#leave');
  if (leave) leave.onclick = () => {
    exitDemo();
    location.hash = '#/gate';
    location.reload();
  };
}
