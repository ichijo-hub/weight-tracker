-- ============================================================
-- Weight Tracker – Supabase schema
-- Supabase SQL Editor で実行してください
-- ============================================================

CREATE TABLE IF NOT EXISTS measurements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  measured_at      DATE NOT NULL,
  weight           NUMERIC(5, 2) NOT NULL,
  body_fat_percent NUMERIC(5, 2),
  lean_mass        NUMERIC(5, 2),
  note             TEXT DEFAULT '',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス（ユーザー別・日付順の検索を高速化）
CREATE INDEX IF NOT EXISTS idx_measurements_user_date
  ON measurements (user_id, measured_at ASC);

-- Row Level Security を有効化
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;

-- ログイン済みユーザーが自分のデータだけ操作できるポリシー
CREATE POLICY "users_own_measurements" ON measurements
  FOR ALL
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
