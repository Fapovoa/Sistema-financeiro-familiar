import { Sidebar } from "@/components/layout/Sidebar";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("audit_items")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return (
    <div className="flex min-h-screen">
      <Sidebar auditCount={count ?? 0} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
