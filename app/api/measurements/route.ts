import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("measurements")
    .select("*")
    .order("measured_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { weight, body_fat_percent, measured_at, note } = body;

  if (!weight || !measured_at) {
    return NextResponse.json({ error: "weight と measured_at は必須です" }, { status: 400 });
  }

  const lean_mass =
    body_fat_percent != null
      ? Math.round(weight * (1 - body_fat_percent / 100) * 100) / 100
      : null;

  const { error } = await supabase.from("measurements").insert({
    user_id: user.id,
    measured_at,
    weight,
    body_fat_percent: body_fat_percent ?? null,
    lean_mass,
    note: note ?? "",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
