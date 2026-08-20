/* ===== config/topics.js — 知識點清單 =====
 *
 * 編碼格式：科目.年級.章節.概念
 * 用點分層是為了讓統計可以任意層級聚合，
 * 例如 math.g8.factor.* 就是「因式分解」整章的正確率。
 */

export const TOPICS = {

  /* ================= 國二數學（八年級上） ================= */
  'math.g8.poly.mult_formula':   { label: '乘法公式', chapter: '乘法公式與多項式' },
  'math.g8.poly.expand':         { label: '多項式展開', chapter: '乘法公式與多項式' },
  'math.g8.factor.common':       { label: '提出公因式', chapter: '因式分解' },
  'math.g8.factor.formula':      { label: '利用乘法公式因式分解', chapter: '因式分解' },
  'math.g8.factor.cross':        { label: '十字交乘法', chapter: '因式分解' },
  'math.g8.sqrt.simplify':       { label: '根式化簡', chapter: '平方根與實數' },
  'math.g8.sqrt.operation':      { label: '根式四則運算', chapter: '平方根與實數' },
  'math.g8.sqrt.estimate':       { label: '根號的估算', chapter: '平方根與實數' },
  'math.g8.pythagoras.basic':    { label: '畢氏定理求邊長', chapter: '畢氏定理' },
  'math.g8.pythagoras.apply':    { label: '畢氏定理的應用', chapter: '畢氏定理' },
  'math.g8.quad.factoring':      { label: '一元二次方程式（因式分解法）', chapter: '一元二次方程式' },
  'math.g8.quad.square_root':    { label: '一元二次方程式（平方根法）', chapter: '一元二次方程式' },

  /* ================= 小五數學 ================= */
  'math.g5.factor.gcd':          { label: '最大公因數', chapter: '因數與倍數' },
  'math.g5.factor.lcm':          { label: '最小公倍數', chapter: '因數與倍數' },
  'math.g5.frac.add_sub':        { label: '異分母分數加減', chapter: '分數' },
  'math.g5.frac.compare':        { label: '分數的比較', chapter: '分數' },
  'math.g5.decimal.mult':        { label: '小數乘法', chapter: '小數' },
  'math.g5.decimal.div':         { label: '小數除法', chapter: '小數' },
  'math.g5.area.triangle':       { label: '三角形面積', chapter: '多邊形面積' },
  'math.g5.area.parallelogram':  { label: '平行四邊形面積', chapter: '多邊形面積' },
  'math.g5.area.trapezoid':      { label: '梯形面積', chapter: '多邊形面積' },
  'math.g5.volume.cuboid':       { label: '長方體與正方體體積', chapter: '體積' },
  'math.g5.percent.basic':       { label: '百分率', chapter: '比率與百分率' },
  'math.g5.speed.basic':         { label: '速率', chapter: '時間與速率' },

  /* ================= 國文（國二） ================= */
  'chinese.g8.reading.classical': { label: '文言文閱讀', chapter: '閱讀' },
  'chinese.g8.reading.modern':    { label: '白話文閱讀', chapter: '閱讀' },
  'chinese.g8.reading.inference': { label: '推論與主旨', chapter: '閱讀' },
  'chinese.g8.word.form':         { label: '形近字辨識', chapter: '字詞' },
  'chinese.g8.word.idiom':        { label: '成語運用', chapter: '字詞' },
  'chinese.g8.rhetoric.figure':   { label: '修辭辨識', chapter: '修辭' },
  'chinese.g8.writing.narrative': { label: '記敘文寫作', chapter: '寫作' },
  'chinese.g8.writing.argument':  { label: '議論文寫作', chapter: '寫作' },

  /* ================= 國語（小五） ================= */
  'chinese.g5.reading.modern':    { label: '白話文閱讀', chapter: '閱讀' },
  'chinese.g5.reading.poem':      { label: '古詩閱讀', chapter: '閱讀' },
  'chinese.g5.word.form':         { label: '形近字與音近字', chapter: '字詞' },
  'chinese.g5.word.idiom':        { label: '成語運用', chapter: '字詞' },
  'chinese.g5.writing.narrative': { label: '記敘文寫作', chapter: '寫作' }
};

/** 取出某科目某程度的所有知識點代碼 */
export function topicsOf(subject, level) {
  const prefix = `${subject}.${level}.`;
  return Object.keys(TOPICS).filter(t => t.startsWith(prefix));
}

/** 知識點顯示名稱 */
export function topicLabel(code) {
  return TOPICS[code]?.label || code;
}

/** 知識點所屬章節 */
export function topicChapter(code) {
  return TOPICS[code]?.chapter || '';
}

/** 從知識點代碼解析出科目與程度 */
export function parseTopic(code) {
  const [subject, level, chapter, concept] = String(code).split('.');
  return { subject, level, chapter, concept };
}

/** 檢查知識點是否已登記 */
export function isKnownTopic(code) {
  return Object.prototype.hasOwnProperty.call(TOPICS, code);
}
