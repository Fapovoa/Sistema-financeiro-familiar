import { NextResponse, type NextRequest } from "next/server";

/** Autenticação desativada temporariamente: tudo liberado. */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = { matcher: [] };
