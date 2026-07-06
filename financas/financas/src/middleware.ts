import { NextResponse, type NextRequest } from "next/server";

/**
 * Porteiro do site: exige o cookie de acesso (gravado pelo login por
 * palavra-chave) em todas as páginas e rotas /api, exceto o próprio login.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const autenticado = request.cookies.get("fp_auth")?.value === "ok";
  if (autenticado) return NextResponse.next();

  // Chamadas de API sem crachá recebem erro; páginas vão para o login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
