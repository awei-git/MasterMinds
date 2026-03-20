import { NextRequest } from "next/server";
import {
  reviewWithAgent,
  aggregateIssues,
  saveReviewRound,
  loadReviewRound,
  loadFullDraft,
  reviseFromIssues,
  type ReviewRound,
  type ReviewIssue,
  type AgentReview,
  type SendFn,
} from "@/lib/agents/review";
import type { ModelProvider } from "@/lib/llm";

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/review — Start or resume a review cycle.
 *
 * The cycle runs one round of parallel review, then pauses for user input.
 * User calls /api/review/continue to proceed with next round.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    projectSlug,
    provider = "claude-code" as ModelProvider,
    round: startRound = 1,
  } = body;

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const fullDraft = loadFullDraft(projectSlug);
  if (!fullDraft) {
    return Response.json({ error: "No draft found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send: SendFn = (data) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(data)));
        } catch { /* stream closed */ }
      };

      try {
        send({ type: "review_start", round: startRound });

        // --- Parallel review: 4 agents simultaneously ---
        const reviewers = ["editor", "character", "reader", "continuity"];
        const results = await Promise.allSettled(
          reviewers.map((role) =>
            reviewWithAgent(role, fullDraft, projectSlug, provider as ModelProvider, send)
          )
        );

        // Collect results
        const reviews: Record<string, AgentReview> = {};
        for (let i = 0; i < reviewers.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            reviews[reviewers[i]] = result.value;
          } else {
            send({ type: "agent_error", agent: reviewers[i], error: String(result.reason) });
            reviews[reviewers[i]] = {
              agent: reviewers[i],
              raw: `Error: ${result.reason}`,
              issues: [],
            };
          }
        }

        // Aggregate issues — also detect P0 from raw text if parser found nothing
        const aggregated = aggregateIssues(reviews);
        let p0Count = aggregated.filter((i) => i.severity === "P0").length;
        let p1Count = aggregated.filter((i) => i.severity === "P1").length;
        let p2Count = aggregated.filter((i) => i.severity === "P2").length;

        // If parser found 0 issues, check raw text for P0 mentions
        if (aggregated.length === 0) {
          for (const review of Object.values(reviews)) {
            if (/P0[（(]|P0.*矛盾|P0.*硬伤|P0.*必须/.test(review.raw)) p0Count++;
            if (/P1[（(]|P1.*应该/.test(review.raw)) p1Count++;
          }
        }
        const hasRawIssues = aggregated.length === 0 && (p0Count > 0 || p1Count > 0);

        send({
          type: "round_summary",
          round: startRound,
          p0: p0Count,
          p1: p1Count,
          p2: p2Count,
          total: aggregated.length,
          readerScore: reviews.reader?.score,
          issues: aggregated,
        });

        // Save round state
        const roundState: ReviewRound = {
          round: startRound,
          timestamp: new Date().toISOString(),
          reviews,
          aggregated,
          status: "awaiting_input",
        };
        saveReviewRound(projectSlug, roundState);

        // Pause — wait for user input via /api/review/continue
        send({
          type: "awaiting_input",
          message: p0Count > 0
            ? `第${startRound}轮审稿完成。发现 ${p0Count} 个P0问题，${p1Count} 个P1问题。请查看后决定是否继续修改。`
            : `第${startRound}轮审稿完成。无P0问题（${p1Count} 个P1，${p2Count} 个P2）。稿件可以通过。`,
        });

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * GET /api/review?projectSlug=xxx&round=N — Get review state for a round.
 */
export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");
  const round = parseInt(req.nextUrl.searchParams.get("round") || "1");

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  const state = loadReviewRound(projectSlug, round);
  if (!state) {
    return Response.json({ error: "Round not found" }, { status: 404 });
  }

  return Response.json(state);
}
