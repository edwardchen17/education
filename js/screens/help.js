/* ===== screens/help.js — 使用說明（任務 13.2） =====
 *
 * 寫給小孩看的，所以句子短、不用術語，只講他們會遇到的事。
 * 這一頁不需要連線，任何時候都能打開。
 */

import { APP_VERSION } from '../config.js';

const STEPS = [
  ['1', '選自己的名字', '第一次進來可以把名字改成你喜歡的樣子。之後要改名字要請爸爸幫忙。'],
  ['2', '看今天有幾堂課', '平常一天一堂，暑假一天兩堂。上面會寫科目和大概要花多久。'],
  ['3', '按開始作答', '題目一題一題來。上面的數字是計時器，會一直往前跑。'],
  ['4', '答案填好會自動記住', '選擇題點一下選項，會變成有顏色的那個。填空題直接打字。'],
  ['5', '想不出來可以看解題邏輯', '按「看解題邏輯」會告訴你怎麼想。這一題就不算分了，但過幾天會再出一次類似的題目給你。'],
  ['6', '交卷前會問你一次', '會列出每一題你選了什麼。看一下有沒有漏掉的，再按確定。'],
  ['7', '馬上看到分數', '選擇題和填空題馬上就有結果。作文要等老師改完，分數會先寫「暫定」。'],
  ['8', '老師改完會通知你', '下次進來會看到「作文改好了」，點進去可以看老師寫的評語。']
];

const FAQ = [
  ['分數怎麼算？', '題目越難分數越高。作文一篇最多 30 分，選擇題一題 2 分。做得越多，累積的積分就越高。'],
  ['連續每天做有好處嗎？', '有。連續七天開始有額外加成，最多加到兩成半。'],
  ['答錯了會怎樣？', '不會扣分。答錯的觀念過三天會再出一次，答對了就往後排，連續答對三次就算學會了。'],
  ['計時器可以停嗎？', '可以按暫停。不過老師看得到你暫停了幾次、實際花了多久，所以別把它當作偷時間用。'],
  ['寫到一半要吃飯怎麼辦？', '直接離開就好，寫過的答案會留著。下次進來按同一堂課就會接著寫。'],
  ['網路斷了怎麼辦？', '已經載入的題目還是可以寫，答案會先存在這台電腦上。網路回來以後交卷就會送上去。'],
  ['我的答案送錯了怎麼辦？', '交卷前的確認清單會列出每一題你選了什麼，發現不對可以回去改。']
];

export default {
  async render(host) {
    host.innerHTML = `
      <div class="wrap">
        <div class="card">
          <div class="card-title">怎麼用這個系統</div>
          <div class="t-sm t-dim">每天一堂課，二十到四十分鐘。不用急，想清楚再答。</div>
        </div>

        <div class="card">
          <div class="card-title">八個步驟</div>
          ${STEPS.map(([n, title, body]) => `
            <div class="help-step">
              <div class="help-n">${n}</div>
              <div class="grow">
                <div class="help-title">${title}</div>
                <div class="t-sm t-dim">${body}</div>
              </div>
            </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-title">常見問題</div>
          ${FAQ.map(([q, a]) => `
            <div class="help-step">
              <div class="grow">
                <div class="help-title t-gold">${q}</div>
                <div class="t-sm t-dim">${a}</div>
              </div>
            </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-title">給爸媽</div>
          <div class="t-sm t-dim">
            老師介面在下面的「老師」按鈕，需要密碼。
            裡面可以批改作文、指派課堂、調整難度與每日堂數。
            如果畫面看起來不對，先按 Ctrl 加 Shift 加 R 強制重新載入，
            再確認右下角的版本號是不是最新的。
          </div>
          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:12px">
            <button data-go="home" class="btn-primary">回到今日任務</button>
            <button data-go="admin">老師</button>
            <span class="grow"></span>
            <button data-go="students">換人</button>
          </div>
          <div class="build-tag">版本 ${APP_VERSION}</div>
        </div>
      </div>`;

    host.querySelectorAll('[data-go]').forEach(b =>
      b.onclick = () => { location.hash = '#/' + b.dataset.go; });
  }
};
