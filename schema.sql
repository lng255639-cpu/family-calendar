-- 事件
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  start_at INTEGER NOT NULL,              -- 毫秒時間戳 (UTC)
  remind_before INTEGER NOT NULL DEFAULT 0, -- 提前幾分鐘多提醒一次，0 = 不提前
  repeat TEXT NOT NULL DEFAULT 'none',    -- none / daily / weekly / monthly / yearly
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,       -- 準時提醒已發
  early_notified INTEGER NOT NULL DEFAULT 0  -- 提前提醒已發
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);

-- 每台手機的推播訂閱
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  last_alert_id INTEGER NOT NULL DEFAULT 0,  -- 這台手機已取走的最後一則提醒
  created_at INTEGER NOT NULL
);

-- 已觸發的提醒（手機收到推播後來這裡取內容）
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target TEXT,          -- NULL = 全家，否則只給這個 endpoint（測試通知用）
  fired_at INTEGER NOT NULL
);
