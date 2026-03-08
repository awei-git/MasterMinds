import { syncAppStatus } from "@/lib/status";

// GET /api/status — trigger status sync and return current status
export async function GET() {
  await syncAppStatus();
  return Response.json({ ok: true, syncedAt: new Date().toISOString() });
}
