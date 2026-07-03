"use client";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { brl } from "@/lib/format";

export function Donut({ data, centerLabel, centerValue }: {
  data: { name: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  return (
    <div className="relative h-72">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="62%" outerRadius="92%" paddingAngle={2} strokeWidth={0}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip formatter={(v: number) => brl(v)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-sm text-ink-500">{centerLabel}</p>
          <p className="text-xl font-bold">{centerValue}</p>
        </div>
      </div>
    </div>
  );
}
