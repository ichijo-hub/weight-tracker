import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase-server";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const image = formData.get("image") as File | null;
  if (!image) return NextResponse.json({ error: "画像が見つかりません" }, { status: 400 });

  const arrayBuffer = await image.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const ext = image.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

  const prompt = [
    "この体重計アプリのスクリーンショットから、体重（kg）と体脂肪率（%）を読み取ってください。",
    "必ず以下のJSON形式のみで返答してください（他のテキストは不要）:",
    '{"weight": <数値またはnull>, "body_fat_percent": <数値またはnull>, "measured_date": "<YYYY-MM-DD形式またはnull>", "confidence": "<high/medium/low>"}',
    "- weight: 体重(kg)の数値",
    "- body_fat_percent: 体脂肪率(%)の数値",
    "- measured_date: 日付が表示されていればYYYY-MM-DD形式、なければnull",
    "- confidence: 読み取り精度（high/medium/low）",
    "数値が読み取れない場合はnullにしてください。",
  ].join("\n");

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
  });

  const raw = (result.text ?? "")
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```$/m, "")
    .trim();

  const data = JSON.parse(raw);
  const weight = data.weight ?? null;
  const bodyFatPercent = data.body_fat_percent ?? null;
  const leanMass =
    weight !== null && bodyFatPercent !== null
      ? Math.round(weight * (1 - bodyFatPercent / 100) * 100) / 100
      : null;

  return NextResponse.json({
    weight,
    body_fat_percent: bodyFatPercent,
    lean_mass: leanMass,
    measured_date: data.measured_date ?? null,
    confidence: data.confidence ?? "low",
  });
}
