"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { Measurement } from "@/lib/types";

interface Props {
  measurements: Measurement[];
  targetLeanMass?: number | null;
}

export default function WeightChart({ measurements, targetLeanMass }: Props) {
  if (measurements.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
        データがありません
      </div>
    );
  }

  const data = measurements.map(m => ({
    date: m.measured_at,
    体重: m.weight,
    除脂肪体重: m.lean_mass,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: "#6b7280" }}
          tickFormatter={d => {
            const [, m, day] = d.split("-");
            return `${parseInt(m)}/${parseInt(day)}`;
          }}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#6b7280" }}
          unit="kg"
          domain={["auto", "auto"]}
          width={52}
        />
        <Tooltip
          formatter={(value: number, name: string) => [`${value} kg`, name]}
          labelFormatter={label => `📅 ${label}`}
          contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        <Line
          type="monotone"
          dataKey="体重"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#3b82f6" }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="除脂肪体重"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#22c55e" }}
          connectNulls
        />
        {targetLeanMass != null && (
          <ReferenceLine
            y={targetLeanMass}
            stroke="#f97316"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            label={{
              value: `目標 ${targetLeanMass} kg`,
              position: "insideTopRight",
              fontSize: 11,
              fill: "#f97316",
            }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
