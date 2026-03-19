import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const SAMPLE_MEASUREMENTS = [
  { measured_at: "2025-12-20", weight: 72.4, body_fat_percent: 22.0 },
  { measured_at: "2025-12-27", weight: 72.1, body_fat_percent: 21.8 },
  { measured_at: "2026-01-03", weight: 71.8, body_fat_percent: 21.5 },
  { measured_at: "2026-01-10", weight: 71.5, body_fat_percent: 21.2 },
  { measured_at: "2026-01-17", weight: 71.0, body_fat_percent: 20.9 },
  { measured_at: "2026-01-24", weight: 70.8, body_fat_percent: 20.7 },
  { measured_at: "2026-01-31", weight: 70.5, body_fat_percent: 20.4 },
  { measured_at: "2026-02-07", weight: 70.2, body_fat_percent: 20.1 },
  { measured_at: "2026-02-14", weight: 69.9, body_fat_percent: 19.8 },
  { measured_at: "2026-02-21", weight: 69.6, body_fat_percent: 19.5 },
  { measured_at: "2026-02-28", weight: 69.3, body_fat_percent: 19.2 },
  { measured_at: "2026-03-07", weight: 69.0, body_fat_percent: 18.9 },
  { measured_at: "2026-03-14", weight: 68.7, body_fat_percent: 18.6 },
];

// クライアント側でログイン後にこのエンドポイントを呼んでシードする
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { count } = await admin
    .from("measurements")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (count === 0) {
    const rows = SAMPLE_MEASUREMENTS.map(m => ({
      user_id: user.id,
      measured_at: m.measured_at,
      weight: m.weight,
      body_fat_percent: m.body_fat_percent,
      lean_mass: Math.round(m.weight * (1 - m.body_fat_percent / 100) * 100) / 100,
      note: "",
    }));
    await admin.from("measurements").insert(rows);
  }

  return NextResponse.json({ ok: true });
}
