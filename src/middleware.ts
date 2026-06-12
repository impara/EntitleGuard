import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth for /admin. Enabled only when ADMIN_PASSWORD is set —
 * without it the route is a hard 404, so the page can never be exposed
 * unprotected by accident.
 */
export function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return new NextResponse(null, { status: 404 });
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [user, pass] = atob(auth.slice(6)).split(":");
    if (user === "admin" && pass === password) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="EntitleGuard admin"' },
  });
}

export const config = {
  matcher: "/admin/:path*",
};
