import { NextRequest } from "next/server";
import {
  loadReviewRound,
  saveReviewRound,
  loadFullDraft,
  reviseFromIssues,
  reviewWithAgent,
  aggregateIssues,
  type ReviewRound,
  type AgentReview,
  type SendFn,
} from "@/lib/agents/review";
import type { ModelProvider } from "@/lib/llm";

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/review/continue — User responds after review pause.
 *
 * Actions:
 *   "continue" — accept/reject issues, revise, then re-review
 *   "stop"     — save final state, end review cycle
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    projectSlug,
    action = "continue",      // "continue" | "stop"
    round: currentRound = 1,
    provider = "claude-code" as ModelProvider,
    maxRounds = 5,
    comments = "",
    issueUpdates = [],        // [{id, status, reason}]
  } = body;

  if (!projectSlug) {
    return Response.json({ error: "projectSlug required" }, { status: 400 });
  }

  // Load current round state
  const roundState = loadReviewRound(projectSlug, currentRound);
  if (!roundState) {
    return Response.json({ error: `Round ${currentRound} not found` }, { status: 404 });
  }

  // Apply user's issue updates
  if (issueUpdates.length > 0) {
    for (const update of issueUpdates) {
      const issue = roundState.aggregated.find((i) => i.id === update.id);
      if (issue) {
        issue.status = update.status;
      }
    }
  }
  roundState.userComments = comments;
  roundState.userIssueUpdates = issueUpdates;

  // If user says stop, mark complete and return
  if (action === "stop") {
    roundState.status = "complete";
    saveReviewRound(projectSlug, roundState);
    return Response.json({ status: "complete", round: currentRound });
  }

  // Check if we've hit max rounds
  if (currentRound >= maxRounds) {
    roundState.status = "complete";
    saveReviewRound(projectSlug, roundState);
    return Response.json({
      status: "complete",
      round: currentRound,
      message: `已达最大轮次 (${maxRounds})`,
    });
  }

  // Check if there are still open P0 issues
  const openP0 = roundState.aggregated.filter(
    (i) => i.severity === "P0" && (i.status === "open" || i.status === "accepted")
  );

  // Also check raw text for P0 if parser found nothing
  const hasRawP0 = openP0.length === 0 && Object.values(roundState.reviews).some(
    (r) => /P0[（(]|P0.*矛盾|P0.*硬伤|P0.*必须/.test(r.raw)
  );

  if (openP0.length === 0 && !hasRawP0) {
    roundState.status = "complete";
    saveReviewRound(projectSlug, roundState);
    return Response.json({
      status: "complete",
      round: currentRound,
      message: "所有P0问题已解决或被拒绝",
    });
  }

  // --- Continue: revise then re-review ---
  roundState.status = "revising";
  saveReviewRound(projectSlug, roundState);

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send: SendFn = (data) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(data)));
        } catch { /* stream closed */ }
      };

      try {
        // Step 1: Writer revises based on open issues
        const fullDraft = loadFullDraft(projectSlug);
        send({ type: "revise_start", round: currentRound + 1 });

        const revisedDraft = await reviseFromIssues(
          fullDraft,
          roundState.aggregated,
          projectSlug,
          provider as ModelProvider,
          send,
          roundState.reviews,
        );

        // TODO: Save revised draft back to files
        // For now, use the revised text for re-review
        send({ type: "revise_complete" });

        // Step 2: New review round
        const nextRound = currentRound + 1;
        send({ type: "review_start", round: nextRound });

        const reviewers = ["editor", "character", "reader", "continuity"];
        const results = await Promise.allSettled(
          reviewers.map((role) =>
            reviewWithAgent(role, revisedDraft, projectSlug, provider as ModelProvider, send)
          )
        );

        const reviews: Record<string, AgentReview> = {};
        for (let i = 0; i < reviewers.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            reviews[reviewers[i]] = result.value;
          } else {
            reviews[reviewers[i]] = {
              agent: reviewers[i],
              raw: `Error: ${result.reason}`,
              issues: [],
            };
          }
        }

        const aggregated = aggregateIssues(reviews);
        const p0Count = aggregated.filter((i) => i.severity === "P0").length;
        const p1Count = aggregated.filter((i) => i.severity === "P1").length;
        const p2Count = aggregated.filter((i) => i.severity === "P2").length;

        send({
          type: "round_summary",
          round: nextRound,
          p0: p0Count,
          p1: p1Count,
          p2: p2Count,
          total: aggregated.length,
          readerScore: reviews.reader?.score,
          issues: aggregated,
        });

        const newRoundState: ReviewRound = {
          round: nextRound,
          timestamp: new Date().toISOString(),
          reviews,
          aggregated,
          status: "awaiting_input",
        };
        saveReviewRound(projectSlug, newRoundState);

        send({
          type: "awaiting_input",
          message: p0Count > 0
            ? `第${nextRound}轮审稿完成。还有 ${p0Count} 个P0问题。`
            : `第${nextRound}轮审稿通过！无P0问题。`,
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
