import { redirect } from "next/navigation";
/** Autenticação desativada: login redireciona direto para o dashboard. */
export default function LoginPage() { redirect("/dashboard"); }
