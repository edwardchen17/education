-- =====================================================================
--  練習系統 — 資料表結構
--  執行方式：Supabase 後台 → SQL Editor → New query → 貼上全部 → Run
--  這份腳本可以重複執行，不會刪除既有資料，也不會因重跑而報錯。
-- =====================================================================


-- ---------------------------------------------------------------------
--  1. 學生檔位
--     固定四個檔位，id 為 1~4。前兩個預設是 Bruce 與 Melody。
--     settings 存音樂風格、音量、背景開關等個人偏好。
-- ---------------------------------------------------------------------
create table if not exists students (
  id           smallint primary key check (id between 1 and 4),
  name         text        not null,
  level        text        check (level in ('g8', 'g5')),   -- g8 國二上、g5 小五上
  name_locked  boolean     not null default false,          -- 改名一次後鎖定
  settings     jsonb       not null default '{}'::jsonb,
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  2. 各科難度狀態
--     每位學生每個科目一列。recent 存最近 20 題的對錯，用來自動升降難度。
--     locked 為 true 時管理者鎖定難度，不自動調整。
-- ---------------------------------------------------------------------
create table if not exists subject_state (
  student_id  smallint not null references students(id) on delete cascade,
  subject     text     not null,
  difficulty  text     not null default 'basic'
              check (difficulty in ('basic', 'advanced', 'gifted')),
  locked      boolean  not null default false,
  recent      jsonb    not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (student_id, subject)
);


-- ---------------------------------------------------------------------
--  3. 課堂
--     一天一堂（暑假兩堂），由系統自動產生或管理者指派。
--     plan 存這堂課的題目快照清單。
--     timer_seconds  是計時器累計（可暫停，學生看得到）
--     elapsed_seconds是實際經過（不受暫停影響，只有管理者看得到）
--     pending_grading 為 0 時表示成績已是正式的，大於 0 表示還有作文待批改。
-- ---------------------------------------------------------------------
create table if not exists lessons (
  id               bigserial primary key,
  student_id       smallint not null references students(id) on delete cascade,
  lesson_date      date     not null,                       -- 台灣當地日期
  slot_of_day      smallint not null default 1,             -- 當日第幾堂
  subject          text     not null,
  status           text     not null default 'pending'
                   check (status in ('pending', 'active', 'submitted', 'graded')),
  assigned_by      text     not null default 'auto'
                   check (assigned_by in ('auto', 'admin')),
  plan             jsonb    not null,
  timer_seconds    integer  not null default 0,
  elapsed_seconds  integer  not null default 0,
  pause_count      integer  not null default 0,
  score_earned     numeric(8,2),
  score_max        numeric(8,2),
  pending_grading  integer  not null default 0,
  points_awarded   numeric(8,2),
  started_at       timestamptz,
  submitted_at     timestamptz,
  graded_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (student_id, lesson_date, slot_of_day)             -- 防止多裝置重複建立
);


-- ---------------------------------------------------------------------
--  4. 作答紀錄
--     question 欄位存「當時看到的完整題目」，包含題幹、選項、正解、解析。
--     這樣即使日後出題程式改動，歷史考卷內容也不會變。
--     revealed  = 看過解題邏輯，該題零分
--     needs_grading = 作文或簡答，等管理者批改
-- ---------------------------------------------------------------------
create table if not exists attempts (
  id             bigserial primary key,
  lesson_id      bigint   not null references lessons(id) on delete cascade,
  student_id     smallint not null references students(id) on delete cascade,
  seq            smallint not null,                          -- 這堂課的第幾題
  question       jsonb    not null,                          -- 題目快照
  subject        text     not null,
  topic          text     not null,
  qtype          text     not null,   -- mc 單選 / mmc 多選 / fill 填空 / calc 計算 / short 簡答 / essay 作文
  difficulty     text     not null,
  answer         jsonb,
  is_correct     boolean,
  revealed       boolean  not null default false,
  needs_grading  boolean  not null default false,
  score          numeric(6,2),
  max_score      numeric(6,2) not null,
  grade          jsonb,               -- 老師批改：{ score, comment, marks: [...] }
  seconds        integer  not null default 0,
  created_at     timestamptz not null default now(),
  unique (lesson_id, seq)
);


-- ---------------------------------------------------------------------
--  5. 知識點精熟與複習排程（間隔重複）
--     box 0 = 剛答錯進佇列，3 天後複習
--     box 1 = 第一次複習答對，7 天後再來
--     box 2 = 第二次答對，14 天後再來
--     box 3 = 第三次答對，標記精熟並離開佇列
-- ---------------------------------------------------------------------
create table if not exists topic_mastery (
  student_id   smallint not null references students(id) on delete cascade,
  topic        text     not null,
  subject      text     not null,
  box          smallint not null default 0 check (box between 0 and 3),
  due_on       date,
  streak       smallint not null default 0,
  wrong_count  integer  not null default 0,
  mastered     boolean  not null default false,
  last_seen    timestamptz,
  primary key (student_id, topic)
);


-- ---------------------------------------------------------------------
--  6. 積分流水帳
--     只新增、不修改、不刪除。累積積分 = 這張表的加總。
--     這樣設計是為了讓積分永遠不會因為某次操作出錯而倒退。
-- ---------------------------------------------------------------------
create table if not exists points_ledger (
  id          bigserial primary key,
  student_id  smallint not null references students(id) on delete cascade,
  lesson_id   bigint   references lessons(id) on delete set null,
  kind        text     not null,   -- question 答題 / streak_bonus 連續加成 / grading 批改補分
  points      numeric(8,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  7. 勳章
-- ---------------------------------------------------------------------
create table if not exists badges (
  student_id  smallint not null references students(id) on delete cascade,
  code        text     not null,   -- points / mastery / streak / correction
  level       smallint not null,
  earned_at   timestamptz not null default now(),
  primary key (student_id, code, level)
);


-- ---------------------------------------------------------------------
--  8. 通知
--     graded 成績轉正式 / badge 獲得勳章 / difficulty 難度變動 / assigned 課堂指派
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id          bigserial primary key,
  student_id  smallint not null references students(id) on delete cascade,
  kind        text     not null,
  payload     jsonb    not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
--  9. 系統設定（只有一列，id 固定為 1）
-- ---------------------------------------------------------------------
create table if not exists app_settings (
  id               smallint primary key default 1 check (id = 1),
  summer_start     text     not null default '07-01',
  summer_end       text     not null default '08-31',
  lessons_weekday  smallint not null default 1,
  lessons_summer   smallint not null default 2,
  target_minutes   smallint not null default 25,
  rotation         jsonb    not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 10. 管理者自訂題目
-- ---------------------------------------------------------------------
create table if not exists custom_questions (
  id          uuid primary key default gen_random_uuid(),
  subject     text    not null,
  topic       text    not null,
  difficulty  text    not null,
  payload     jsonb   not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);


-- =====================================================================
--  索引
-- =====================================================================
create index if not exists lessons_student_date_idx on lessons (student_id, lesson_date desc);
create index if not exists lessons_pending_idx      on lessons (student_id) where pending_grading > 0;
create index if not exists attempts_lesson_idx      on attempts (lesson_id);
create index if not exists attempts_student_idx     on attempts (student_id, created_at desc);
create index if not exists attempts_grading_idx     on attempts (student_id) where needs_grading = true;
create index if not exists attempts_topic_idx       on attempts (student_id, topic);
create index if not exists mastery_due_idx          on topic_mastery (student_id, due_on) where mastered = false;
create index if not exists ledger_student_idx       on points_ledger (student_id);
create index if not exists notif_unread_idx         on notifications (student_id) where read_at is null;


-- =====================================================================
--  Row Level Security
--
--  只有「已登入家庭帳號」的連線能讀寫。
--  光有網頁裡那組 publishable key 但沒登入的請求，屬於 anon 角色，
--  找不到任何適用的政策，因此讀寫全部被資料庫拒絕。
-- =====================================================================
alter table students         enable row level security;
alter table subject_state    enable row level security;
alter table lessons          enable row level security;
alter table attempts         enable row level security;
alter table topic_mastery    enable row level security;
alter table points_ledger    enable row level security;
alter table badges           enable row level security;
alter table notifications    enable row level security;
alter table app_settings     enable row level security;
alter table custom_questions enable row level security;

drop policy if exists family_rw on students;
drop policy if exists family_rw on subject_state;
drop policy if exists family_rw on lessons;
drop policy if exists family_rw on attempts;
drop policy if exists family_rw on topic_mastery;
drop policy if exists family_rw on points_ledger;
drop policy if exists family_rw on badges;
drop policy if exists family_rw on notifications;
drop policy if exists family_rw on app_settings;
drop policy if exists family_rw on custom_questions;

create policy family_rw on students         for all to authenticated using (true) with check (true);
create policy family_rw on subject_state    for all to authenticated using (true) with check (true);
create policy family_rw on lessons          for all to authenticated using (true) with check (true);
create policy family_rw on attempts         for all to authenticated using (true) with check (true);
create policy family_rw on topic_mastery    for all to authenticated using (true) with check (true);
create policy family_rw on points_ledger    for all to authenticated using (true) with check (true);
create policy family_rw on badges           for all to authenticated using (true) with check (true);
create policy family_rw on notifications    for all to authenticated using (true) with check (true);
create policy family_rw on app_settings     for all to authenticated using (true) with check (true);
create policy family_rw on custom_questions for all to authenticated using (true) with check (true);


-- =====================================================================
--  初始資料
--  on conflict do nothing：重複執行不會覆蓋你已經改過的名字或程度。
-- =====================================================================
insert into app_settings (id) values (1)
  on conflict (id) do nothing;

insert into students (id, name, level, name_locked) values
  (1, 'Bruce',  'g8',  false),
  (2, 'Melody', 'g5',  false),
  (3, '學生三', null,  false),
  (4, '學生四', null,  false)
  on conflict (id) do nothing;


-- =====================================================================
--  驗證：執行後應該看到 10 張表，每張的 policies 都是 1、rls 都是 true
-- =====================================================================
select
  c.relname                                as 資料表,
  c.relrowsecurity                         as 已啟用RLS,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as 政策數
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('students','subject_state','lessons','attempts','topic_mastery',
                    'points_ledger','badges','notifications','app_settings','custom_questions')
order by c.relname;
