import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("user_settings")
    .select("target_lean_mass")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ target_lean_mass: data?.target_lean_mass ?? "" });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { target_lean_mass } = await request.json();

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, target_lean_mass: target_lean_mass || null, updated_at: new Date().toISOString() });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
