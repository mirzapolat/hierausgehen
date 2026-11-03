/**
 * Die Kennung des laufenden Builds. Die offene App vergleicht sie mit ihrer
 * eigenen und bietet bei einer Abweichung an, neu zu laden (`UpdateBanner`).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
