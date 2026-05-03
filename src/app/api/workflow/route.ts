import { NextRequest } from "next/server";
import {
  AGENT_DEFINITIONS,
  EXPANSION_PROTOCOL,
  PHASES,
  ROUND_TABLE_PROTOCOL,
  SCRIPTMENT_REVIEW_PROTOCOL,
  normalizePhase,
  nextPhase,
  phaseDefinition,
} from "@/lib/workflow";

export async function GET(req: NextRequest) {
  const phase = req.nextUrl.searchParams.get("phase");
  if (phase) {
    const normalized = normalizePhase(phase);
    return Response.json({
      phase: phaseDefinition(normalized),
      nextPhase: nextPhase(normalized),
      roundtableProtocol: ROUND_TABLE_PROTOCOL,
      scriptmentReviewProtocol: SCRIPTMENT_REVIEW_PROTOCOL,
      expansionProtocol: EXPANSION_PROTOCOL,
    });
  }

  return Response.json({
    phases: PHASES,
    agents: AGENT_DEFINITIONS,
    roundtableProtocol: ROUND_TABLE_PROTOCOL,
    scriptmentReviewProtocol: SCRIPTMENT_REVIEW_PROTOCOL,
    expansionProtocol: EXPANSION_PROTOCOL,
  });
}
