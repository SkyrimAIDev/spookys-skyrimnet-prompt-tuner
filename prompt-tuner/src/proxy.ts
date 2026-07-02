import { NextRequest, NextResponse } from "next/server";

/**
 * Loopback-only guard for all API routes. (Next 16 "proxy" convention — this is
 * the renamed successor to the old `middleware.ts`.)
 *
 * The Next server is bound to 127.0.0.1 inside the Electron shell, but "bound to
 * loopback" is not by itself a security boundary: any web page the user visits
 * while the app is running can issue cross-origin requests to it, and DNS
 * rebinding can smuggle an attacker-controlled origin onto the loopback address.
 * Because the API routes perform real filesystem I/O, that would be exploitable.
 *
 * This proxy closes both vectors for every /api/* route at once:
 *   - Host header must be a loopback name  → defeats DNS rebinding (the browser
 *     sends the attacker's hostname in Host, not 127.0.0.1).
 *   - Origin header, when present, must be loopback → defeats cross-site CSRF.
 *
 * The check is port-agnostic so it works in dev (next dev, :3000) and packaged
 * (:3737) without configuration.
 */

function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  // Strip an optional :port, then IPv6 brackets: "[::1]:3737" → "::1".
  const hostname = hostHeader
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("Forbidden: non-loopback host", { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originOk = false;
    try {
      originOk = isLoopbackHost(new URL(origin).host);
    } catch {
      originOk = false;
    }
    if (!originOk) {
      return new NextResponse("Forbidden: cross-origin request blocked", {
        status: 403,
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
