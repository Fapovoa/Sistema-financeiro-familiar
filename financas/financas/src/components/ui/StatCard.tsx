import clsx from "clsx";
import { LucideIcon } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";

export function StatCard(props: {
  icon: LucideIcon;
  label: string;
  value: string;
  badge?: { text: string; tone: "up" | "down" | "neutral" };
  spark?: number[];
  sparkKind?: "bars" | "area";
}) {
  const { icon: Icon, label, value, badge, spark, sparkKind = "area" } = props;
  return (
    <div className="card flex items-start justify-between gap-3 p-5">
      <div className="min-w-0 flex-1">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
          <Icon size={18} />
        </span>
        <p className="mt-3 text-sm text-ink-500">{label}</p>
        <p className="mt-0.5 break-words text-xl font-bold tracking-tight 2xl:text-2xl">{value}</p>
      </div>
      <div className="flex h-full shrink-0 flex-col items-end justify-between gap-2">
        {badge && (
          <span className={clsx(
            "whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold",
            badge.tone === "up" && "bg-success-bg text-success-fg",
            badge.tone === "down" && "bg-danger-bg text-danger-fg",
            badge.tone === "neutral" && "bg-slate-100 text-ink-500"
          )}>{badge.text}</span>
        )}
        {spark && spark.length > 1 && <Sparkline data={spark} kind={sparkKind} />}
      </div>
    </div>
  );
}
