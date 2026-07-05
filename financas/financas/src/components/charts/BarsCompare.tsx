"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { brl } from "@/lib/format";

export function BarsCompare({ data }: { data: { label: string; receitas: number; despesas: number }[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart data={data} barGap={4}>
          <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748B" }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748B" }}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
          <Tooltip formatter={(v: number) => brl(v)} />
          <Legend iconType="circle" />
          <Bar dataKey="receitas" name="Receitas" fill="#BFFF00" radius={[6, 6, 0, 0]} />
          <Bar dataKey="despesas" name="Despesas" fill="#F74AF2" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
