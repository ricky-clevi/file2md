import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Track last cleanup time
let lastCleanup = 0;
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

export function middleware(request: NextRequest) {
  // Trigger periodic cleanup
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    lastCleanup = now;
    
    // Trigger cleanup in background (don't await)
    fetch(`${request.nextUrl.origin}/api/cleanup`, {
      method: 'POST',
    }).catch(error => {
      console.warn('Background cleanup failed:', error);
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/cleanup (avoid recursive cleanup calls)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api/cleanup|_next/static|_next/image|favicon.ico).*)',
  ],
};