export interface Measurement {
  id: string;
  user_id: string;
  measured_at: string;       // "YYYY-MM-DD"
  weight: number;
  body_fat_percent: number | null;
  lean_mass: number | null;
  created_at: string;
}

export interface AnalyzeResult {
  weight: number | null;
  body_fat_percent: number | null;
  lean_mass: number | null;
  measured_date: string | null;
  confidence: "high" | "medium" | "low";
}
