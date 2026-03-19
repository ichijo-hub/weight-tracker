"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { Measurement, AnalyzeResult } from "@/lib/types";

const WeightChart = dynamic(() => import("./WeightChart"), { ssr: false });

const today = () => new Date().toISOString().slice(0, 10);

function calcLean(weight: string, fat: string): string {
  const w = parseFloat(weight);
  const f = parseFloat(fat);
  if (!isNaN(w) && !isNaN(f)) return (w * (1 - f / 100)).toFixed(2);
  return "--";
}

interface FormState {
  measured_at: string;
  weight: string;
  body_fat_percent: string;
}

function filteredMeasurements(measurements: Measurement[], period: "1m" | "3m" | "6m" | "1y" | "all"): Measurement[] {
  if (period === "all") return measurements;
  const months = period === "1m" ? 1 : period === "3m" ? 3 : period === "6m" ? 6 : 12;
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  const fromStr = from.toISOString().slice(0, 10);
  return measurements.filter(m => m.measured_at >= fromStr);
}

const emptyForm = (): FormState => ({
  measured_at: today(),
  weight: "",
  body_fat_percent: "",
});

export default function Dashboard({ email }: { email: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<AnalyzeResult["confidence"] | null>(null);
  const [pendingForm, setPendingForm] = useState<FormState | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState<FormState>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tableExpanded, setTableExpanded] = useState(false);
  const [progress, setProgress] = useState<{ label: string; current: number; total: number } | null>(null);
  const [chartPeriod, setChartPeriod] = useState<"1m" | "3m" | "6m" | "1y" | "all">(
    () => (typeof window !== "undefined" ? localStorage.getItem("chartPeriod") as "1m" | "3m" | "6m" | "1y" | "all" : null) ?? "all"
  );

  const updateChartPeriod = (p: "1m" | "3m" | "6m" | "1y" | "all") => {
    setChartPeriod(p);
    localStorage.setItem("chartPeriod", p);
  };
  const [targetLeanMass, setTargetLeanMass] = useState<string>("");

  const updateTargetLeanMass = async (v: string) => {
    setTargetLeanMass(v);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_lean_mass: v }),
    });
  };

  const showToast = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    const res = await fetch("/api/measurements");
    if (res.ok) setMeasurements(await res.json());
  }, []);

  useEffect(() => {
    load();
    fetch("/api/settings").then(r => r.json()).then(d => {
      if (d.target_lean_mass) setTargetLeanMass(d.target_lean_mass.toString());
    });
  }, [load]);

  async function handleCsvImport(file: File) {
    setCsvImporting(true);
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { showToast("データがありません", true); return; }

      // ヘッダー行を正規化
      const headers = lines[0].split(",").map(h =>
        h.trim().replace(/^"|"$/g, "").toLowerCase()
      );

      const dateIdx = headers.findIndex(h => /date|日付|measured/.test(h));
      const weightIdx = headers.findIndex(h => /weight|体重/.test(h));
      const fatIdx = headers.findIndex(h => /fat|脂肪/.test(h));

      if (dateIdx === -1 || weightIdx === -1) {
        showToast("CSVに日付・体重の列が見つかりません", true); return;
      }

      const rows = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        const weight = parseFloat(cols[weightIdx]);
        const fat = fatIdx !== -1 ? parseFloat(cols[fatIdx]) : NaN;
        return {
          measured_at: cols[dateIdx],
          weight,
          body_fat_percent: isNaN(fat) ? null : fat,
        };
      }).filter(r => r.measured_at && !isNaN(r.weight));

      if (rows.length === 0) { showToast("有効なデータがありません", true); return; }

      // 既存データを取得して日付→IDのマップを作る
      const existing = await fetch("/api/measurements").then(r => r.json()) as Measurement[];
      const dateToId = Object.fromEntries(existing.map(m => [m.measured_at, m.id]));

      let success = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setProgress({ label: "CSVインポート中", current: i + 1, total: rows.length });
        const existingId = dateToId[row.measured_at];
        const method = existingId ? "PUT" : "POST";
        const url = existingId ? `/api/measurements/${existingId}` : "/api/measurements";
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
        });
        if (res.ok) success++;
      }

      setProgress(null);
      showToast(`${success}件インポートしました ✓`);
      load();
    } catch {
      showToast("CSVの読み込みに失敗しました", true);
    } finally {
      setCsvImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // ---- Upload ----
  function handleFile(file: File) {
    setPreviewUrl(URL.createObjectURL(file));
    analyzeImage(file);
  }

  async function analyzeImage(file: File) {
    setAnalyzing(true);
    setPendingForm(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data: AnalyzeResult = await res.json();
      if (!res.ok) { showToast((data as { error?: string }).error ?? "解析に失敗しました", true); return; }
      setConfidence(data.confidence);
      setPendingForm({
        measured_at: data.measured_date ?? today(),
        weight: data.weight?.toString() ?? "",
        body_fat_percent: data.body_fat_percent?.toString() ?? "",
      });
    } catch {
      showToast("通信エラーが発生しました", true);
    } finally {
      setAnalyzing(false);
    }
  }

  async function savePending() {
    if (!pendingForm) return;
    if (!pendingForm.weight || !pendingForm.measured_at) {
      showToast("体重と日付は必須です", true); return;
    }
    const res = await fetch("/api/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weight: parseFloat(pendingForm.weight),
        body_fat_percent: pendingForm.body_fat_percent ? parseFloat(pendingForm.body_fat_percent) : null,
        measured_at: pendingForm.measured_at,
      }),
    });
    if (!res.ok) { showToast("保存に失敗しました", true); return; }
    showToast("保存しました ✓");
    setPendingForm(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  async function saveManual() {
    if (!manualForm.weight || !manualForm.measured_at) {
      showToast("体重と日付は必須です", true); return;
    }
    const res = await fetch("/api/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weight: parseFloat(manualForm.weight),
        body_fat_percent: manualForm.body_fat_percent ? parseFloat(manualForm.body_fat_percent) : null,
        measured_at: manualForm.measured_at,
      }),
    });
    if (!res.ok) { showToast("保存に失敗しました", true); return; }
    showToast("保存しました ✓");
    setManualForm(emptyForm());
    setShowManual(false);
    load();
  }

  async function submitEdit() {
    if (!editId || !editForm.weight || !editForm.measured_at) {
      showToast("体重と日付は必須です", true); return;
    }
    const res = await fetch(`/api/measurements/${editId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weight: parseFloat(editForm.weight),
        body_fat_percent: editForm.body_fat_percent ? parseFloat(editForm.body_fat_percent) : null,
        measured_at: editForm.measured_at,
      }),
    });
    if (!res.ok) { showToast("更新に失敗しました", true); return; }
    showToast("更新しました ✓");
    setEditId(null);
    load();
  }

  async function deleteBulk() {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size}件のデータを削除しますか？`)) return;
    const ids = [...selectedIds];
    let done = 0;
    for (const id of ids) {
      setProgress({ label: "削除中", current: ++done, total: ids.length });
      await fetch(`/api/measurements/${id}`, { method: "DELETE" });
    }
    setProgress(null);
    showToast(`${ids.length}件削除しました`);
    setSelectedIds(new Set());
    load();
  }

  async function deleteMeasurement(id: string) {
    if (!confirm("この記録を削除しますか？")) return;
    const res = await fetch(`/api/measurements/${id}`, { method: "DELETE" });
    if (!res.ok) { showToast("削除に失敗しました", true); return; }
    showToast("削除しました");
    load();
  }

  const confidenceLabel: Record<string, string> = {
    high: "読み取り精度: 高",
    medium: "読み取り精度: 中",
    low: "読み取り精度: 低（要確認）",
  };
  const confidenceColor: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-red-100 text-red-700",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-lg">⚖️</span>
          <h1 className="text-sm font-bold">除脂肪体重トラッカー</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 hidden sm:block">{email}</span>
          <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-700">
            ログアウト
          </button>
        </div>
      </header>

      {/* Progress bar */}
      {progress && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100 px-6 py-3 shadow-sm">
          <div className="max-w-3xl mx-auto">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>{progress.label}</span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-3 py-3 space-y-3">

        {/* Upload Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
              dragOver ? "border-blue-400 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/50"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <span className="text-2xl">📷</span>
            <div>
              <p className="text-sm font-medium text-blue-600">スクショを取り込む</p>
              <p className="text-xs text-gray-400">タップまたはドラッグ＆ドロップ</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
          />

          {/* Preview */}
          {previewUrl && (
            <img src={previewUrl} alt="preview" className="mt-4 max-h-56 rounded-lg object-contain mx-auto" />
          )}

          {/* Analyzing spinner */}
          {analyzing && (
            <div className="mt-4 flex items-center gap-3 text-sm text-gray-500">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              AIが解析中...
            </div>
          )}

          {/* Result form */}
          {pendingForm && !analyzing && (
            <div className="mt-5 space-y-4">
              {confidence && (
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${confidenceColor[confidence]}`}>
                  {confidenceLabel[confidence]}
                </span>
              )}
              <FormGrid
                form={pendingForm}
                onChange={setPendingForm}
              />
              <div className="flex gap-3">
                <button onClick={savePending} className="btn-primary">保存する</button>
                <button onClick={() => { setPendingForm(null); setPreviewUrl(null); }} className="btn-outline">
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* Manual entry */}
          <div className="mt-2 border-t border-gray-50 pt-2 flex flex-wrap gap-3 items-start">
            <button
              onClick={() => setShowManual(v => !v)}
              className="text-sm text-blue-600 font-medium hover:underline"
            >
              {showManual ? "手動入力を閉じる" : "手動で入力する"}
            </button>
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={csvImporting}
              className="text-sm text-blue-600 font-medium hover:underline disabled:opacity-50"
            >
              {csvImporting ? "インポート中..." : "CSVでインポート"}
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleCsvImport(e.target.files[0]); }}
            />
            {showManual && (
              <div className="mt-4 space-y-4">
                <FormGrid form={manualForm} onChange={setManualForm} />
                <div className="flex gap-3">
                  <button onClick={saveManual} className="btn-primary">保存する</button>
                  <button onClick={() => setShowManual(false)} className="btn-outline">閉じる</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">推移グラフ</h2>
            <div className="flex gap-1">
              {(["1m","3m","6m","1y","all"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => updateChartPeriod(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    chartPeriod === p
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {p === "1m" ? "1ヶ月" : p === "3m" ? "3ヶ月" : p === "6m" ? "6ヶ月" : p === "1y" ? "1年" : "全期間"}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 whitespace-nowrap">除脂肪体重の目標</label>
              <div className="relative w-28">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={targetLeanMass}
                  onChange={e => updateTargetLeanMass(e.target.value)}
                  placeholder="0.0"
                  className="input w-full pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">kg</span>
              </div>
              {targetLeanMass && (
                <button onClick={() => updateTargetLeanMass("")} className="text-xs text-gray-400 hover:text-gray-600">
                  クリア
                </button>
              )}
            </div>
            {(() => {
              if (!targetLeanMass) return null;
              const target = parseFloat(targetLeanMass);
              if (isNaN(target)) return null;
              const oneWeekAgo = new Date();
              oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
              const fromStr = oneWeekAgo.toISOString().slice(0, 10);
              const recent = measurements.filter(m => m.measured_at >= fromStr && m.lean_mass != null);
              if (recent.length === 0) return (
                <p className="text-xs text-gray-400">直近1週間のデータがありません</p>
              );
              const avg = recent.reduce((s, m) => s + m.lean_mass!, 0) / recent.length;
              const diff = target - avg;
              const sign = diff > 0 ? "+" : "";
              const color = diff > 0 ? "text-orange-500" : "text-green-600";
              return (
                <p className="text-xs text-gray-500">
                  直近1週間の平均除脂肪体重: <span className="font-medium">{avg.toFixed(2)} kg</span>
                  　目標まで: <span className={`font-bold ${color}`}>{sign}{diff.toFixed(2)} kg</span>
                </p>
              );
            })()}
          </div>
          <WeightChart
            measurements={filteredMeasurements(measurements, chartPeriod)}
            targetLeanMass={targetLeanMass ? parseFloat(targetLeanMass) : null}
          />
        </div>

        {/* Table Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              記録一覧
            </h2>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteBulk}
                className="text-xs font-semibold text-red-500 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-50"
              >
                {selectedIds.size}件を削除
              </button>
            )}
          </div>
          {measurements.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">データがありません</p>
          ) : (
            <div>
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead>
                  <tr className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                    <th className="py-2 px-1">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === measurements.length}
                        onChange={e =>
                          setSelectedIds(e.target.checked ? new Set(measurements.map(m => m.id)) : new Set())
                        }
                      />
                    </th>
                    <th className="text-left py-2 px-1">日付</th>
                    <th className="text-right py-2 px-1">体重</th>
                    <th className="text-right py-2 px-1">体脂肪率</th>
                    <th className="text-right py-2 px-1">除脂肪体重</th>
                    <th className="py-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {([...measurements].reverse().slice(0, tableExpanded ? undefined : 7)).map(m => (
                    <tr key={m.id} className={`border-t border-gray-50 hover:bg-gray-50/50 ${selectedIds.has(m.id) ? "bg-blue-50/50" : ""}`}>
                      <td className="py-2 px-1">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(m.id)}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            e.target.checked ? next.add(m.id) : next.delete(m.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                      <td className="py-2 px-1 font-medium whitespace-nowrap">{m.measured_at}</td>
                      <td className="py-2 px-1 text-right whitespace-nowrap">{m.weight}kg</td>
                      <td className="py-2 px-1 text-right whitespace-nowrap">{m.body_fat_percent != null ? `${m.body_fat_percent}%` : "-"}</td>
                      <td className="py-2 px-1 text-right text-green-600 font-medium whitespace-nowrap">
                        {m.lean_mass != null ? `${m.lean_mass}kg` : "-"}
                      </td>
                      <td className="py-2 px-1">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => {
                              setEditId(m.id);
                              setEditForm({
                                measured_at: m.measured_at,
                                weight: m.weight.toString(),
                                body_fat_percent: m.body_fat_percent?.toString() ?? "",
                              });
                            }}
                            className="text-xs text-blue-600 hover:underline px-1"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => deleteMeasurement(m.id)}
                            className="text-xs text-red-500 hover:underline px-1"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {measurements.length > 7 && (
                <button
                  onClick={() => setTableExpanded(v => !v)}
                  className="mt-3 w-full text-xs text-gray-400 hover:text-gray-600 py-2 border-t border-gray-50"
                >
                  {tableExpanded ? "▲ 折りたたむ" : `▼ 残り ${measurements.length - 7} 件を表示`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editId && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4"
          onClick={e => { if (e.target === e.currentTarget) setEditId(null); }}
        >
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold text-base mb-4">記録を編集</h3>
            <FormGrid form={editForm} onChange={setEditForm} />
            <div className="flex gap-3 mt-4">
              <button onClick={submitEdit} className="btn-primary">更新</button>
              <button onClick={() => setEditId(null)} className="btn-outline">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-full text-sm font-medium text-white shadow-lg transition-all z-50 ${
          toast.error ? "bg-red-500" : "bg-gray-800"
        }`}>
          {toast.msg}
        </div>
      )}

      <style jsx global>{`
        .btn-primary {
          display: inline-flex; align-items: center; padding: 8px 18px;
          background: #2563eb; color: white; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; border: none;
          transition: background 0.15s;
        }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-outline {
          display: inline-flex; align-items: center; padding: 8px 18px;
          background: white; color: #2563eb; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer;
          border: 1px solid #2563eb; transition: background 0.15s;
        }
        .btn-outline:hover { background: #eff6ff; }
      `}</style>
    </div>
  );
}

// ---- Shared form grid ----
function FormGrid({ form, onChange }: {
  form: FormState;
  onChange: (f: FormState) => void;
}) {
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...form, [key]: e.target.value });

  const lean = calcLean(form.weight, form.body_fat_percent);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">測定日</label>
        <input type="date" className="input" value={form.measured_at} onChange={set("measured_at")} />
      </div>
      <div>
        <label className="label">体重 (kg)</label>
        <input type="number" step="0.1" min="0" className="input" value={form.weight} onChange={set("weight")} placeholder="68.5" />
      </div>
      <div>
        <label className="label">体脂肪率 (%)</label>
        <input type="number" step="0.1" min="0" max="100" className="input" value={form.body_fat_percent} onChange={set("body_fat_percent")} placeholder="18.0" />
      </div>
      <div className="col-span-2 bg-blue-50 rounded-lg px-4 py-3 flex justify-between items-center">
        <span className="text-sm text-gray-600">除脂肪体重（体重 × (1 - 体脂肪率)）</span>
        <span className="text-xl font-bold text-blue-600">{lean !== "--" ? `${lean} kg` : "--"}</span>
      </div>
      <style jsx global>{`
        .label { display: block; font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 4px; }
        .input {
          width: 100%; border: 1px solid #e5e7eb; border-radius: 8px;
          padding: 9px 12px; font-size: 14px; outline: none;
          transition: border-color 0.15s;
        }
        .input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
      `}</style>
    </div>
  );
}
