"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { brl } from "@/lib/format";

export function AreaTrend({ data, dataKey = "value" }: {
  data: Record<string, string | number>[];
  dataKey?: string;
}) {
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="fillBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4A6CF7" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#4A6CF7" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748B" }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748B" }}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip formatter={(v: number) => brl(v)} />
          <Area type="monotone" dataKey={dataKey} stroke="#4A6CF7" strokeWidth={2.5} fill="url(#fillBlue)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
