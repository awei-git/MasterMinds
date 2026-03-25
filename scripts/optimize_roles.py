#!/usr/bin/env python3
"""Optimize MasterMinds agent role definitions using AutoResearch.

Evaluates each role prompt on domain-specific criteria, then iteratively
improves the worst-performing ones.

Usage:
    python scripts/optimize_roles.py --action audit
    python scripts/optimize_roles.py --action optimize --role writer --iterations 8
    python scripts/optimize_roles.py --action optimize --role all --budget 120

Roles: writer, editor, architect, character, idea, reader, continuity, chronicler, reviewer
"""
import argparse
import json
import logging
import sys
from pathlib import Path

# Add Mira shared to path for autoresearch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "Mira" / "agents" / "shared"))

from autoresearch import llm_judge, AutoResearchLoop

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("optimize_roles")

ROLES_DIR = Path(__file__).resolve().parent.parent / "agents" / "roles"

# ---------------------------------------------------------------------------
# Role-specific evaluation criteria
# ---------------------------------------------------------------------------

# Shared criteria for all roles
BASE_CRITERIA = {
    "instruction_clarity": (
        "The role definition tells the agent exactly what to do and not do — "
        "no ambiguity about scope, format, or output expectations"
    ),
    "constraint_specificity": (
        "Constraints are concrete rules ('max 500 words', 'never use X'), "
        "not vague guidance ('try to be concise')"
    ),
    "anti_patterns": (
        "Common failure modes are explicitly called out with examples "
        "of what NOT to do"
    ),
}

# Role-specific criteria
ROLE_CRITERIA = {
    "writer": {
        **BASE_CRITERIA,
        "craft_precision": (
            "Writing rules are specific to sentence/paragraph level — "
            "not abstract principles but executable heuristics"
        ),
        "voice_guidance": (
            "Clear reference points for desired style (authors, examples) "
            "that an LLM can actually emulate"
        ),
    },
    "editor": {
        **BASE_CRITERIA,
        "issue_taxonomy": (
            "Types of issues to look for are categorized and prioritized — "
            "the editor knows what matters most"
        ),
        "feedback_format": (
            "Output format is structured for actionability — "
            "the writer can act on feedback without interpretation"
        ),
    },
    "architect": {
        **BASE_CRITERIA,
        "structural_toolkit": (
            "Has concrete structural tools (beat sheets, tension curves, "
            "act structure) rather than just 'plan the story'"
        ),
        "scope_control": (
            "Knows when to stop adding complexity — avoids over-engineering "
            "the outline beyond what the story needs"
        ),
    },
    "character": {
        **BASE_CRITERIA,
        "character_depth": (
            "Goes beyond surface traits to internal contradictions, "
            "desires, and how characters change under pressure"
        ),
        "voice_distinction": (
            "Each character sounds different — specific guidance on "
            "how to make dialogue voice-distinct"
        ),
    },
    "idea": {
        **BASE_CRITERIA,
        "generative_power": (
            "The prompt actually generates novel ideas, not variations "
            "on obvious themes"
        ),
        "feasibility_check": (
            "Ideas are grounded in what's executable for the project's "
            "scope and genre"
        ),
    },
    "reader": {
        **BASE_CRITERIA,
        "scoring_calibration": (
            "Score anchors are detailed enough that different LLMs would "
            "give similar scores on the same text"
        ),
        "reader_perspective": (
            "Evaluates from genuine reader experience, not craft analysis — "
            "'did this hold my attention' not 'is the structure correct'"
        ),
    },
    "continuity": {
        **BASE_CRITERIA,
        "tracking_precision": (
            "Specifies exactly what to track (character states, timeline, "
            "objects, promises) with concrete examples"
        ),
        "error_detection": (
            "Has specific patterns for catching continuity errors — "
            "not just 'check consistency' but how to check"
        ),
    },
    "chronicler": {
        **BASE_CRITERIA,
        "compression_quality": (
            "Summaries capture the right information at the right granularity — "
            "not too detailed, not too abstract"
        ),
    },
    "reviewer": {
        **BASE_CRITERIA,
        "independence": (
            "Reviewer operates independently from editor — different perspective, "
            "different criteria, catches what editor misses"
        ),
    },
}

ROLE_RUBRIC = """Score anchors for agent role definitions:
- 1-3: Generic instructions any LLM would follow by default
- 4-5: Has domain knowledge but lacks concrete execution rules
- 6-7: Specific rules with examples, covers common failure modes
- 8-9: Production-quality prompt — an expert would recognize the craft
- 10: Best-in-class role definition — teaches the LLM something it couldn't infer"""


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

def audit_roles(judge_fn=None) -> list[dict]:
    """Score all role definitions and rank by quality."""
    results = []

    for role_file in sorted(ROLES_DIR.glob("*.md")):
        role_name = role_file.stem
        content = role_file.read_text(encoding="utf-8")
        criteria = ROLE_CRITERIA.get(role_name, BASE_CRITERIA)

        log.info("Auditing role: %s (%d chars)", role_name, len(content))
        eval_result = llm_judge(content, criteria, ROLE_RUBRIC, judge_fn)

        results.append({
            "role": role_name,
            "path": str(role_file),
            "aggregate": eval_result.aggregate,
            "scores": eval_result.scores,
            "reasoning": eval_result.reasoning,
        })

    results.sort(key=lambda r: r["aggregate"])

    # Save
    save_path = ROLES_DIR.parent.parent / "scripts" / "role_audit.json"
    save_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    # Print
    print(f"\n{'='*60}")
    print("MASTERMINDS ROLE AUDIT")
    print(f"{'='*60}")
    for r in results:
        scores_str = "  ".join(f"{k}={v:.1f}" for k, v in r["scores"].items())
        print(f"  {r['aggregate']:5.1f}  {r['role']:15s}  {scores_str}")
    avg = sum(r["aggregate"] for r in results) / max(len(results), 1)
    print(f"\n  Average: {avg:.1f}")

    return results


def optimize_role(role_name: str, iterations: int = 8, budget: float = 20,
                  judge_fn=None) -> dict:
    """Optimize a single role definition."""
    role_file = ROLES_DIR / f"{role_name}.md"
    if not role_file.exists():
        raise FileNotFoundError(f"Role not found: {role_file}")

    criteria = ROLE_CRITERIA.get(role_name, BASE_CRITERIA)

    loop = AutoResearchLoop(
        name=f"mm-role-{role_name}",
        eval_fn=lambda asset_text: asset_text,  # Role definition IS the output
        criteria=criteria,
        directive=(
            f"Optimize the '{role_name}' agent role definition for a collaborative "
            f"fiction writing system. The role instructs an LLM to perform a specific "
            f"function in a multi-agent writers' room.\n\n"
            f"Goals:\n"
            f"- Make instructions executable (concrete rules, not vague guidance)\n"
            f"- Add anti-patterns with examples of what NOT to do\n"
            f"- Keep the same language (Chinese/English mix is fine)\n"
            f"- Preserve existing good content — improve, don't rewrite\n"
            f"- The target reader is an LLM, not a human — optimize for LLM comprehension"
        ),
        asset_path=role_file,
        rubric=ROLE_RUBRIC,
        judge_model_fn=judge_fn,
    )

    return loop.run(max_iterations=iterations, time_budget_minutes=budget)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Audit and optimize MasterMinds roles")
    parser.add_argument("--action", choices=["audit", "optimize"], default="audit")
    parser.add_argument("--role", default="all",
                        help="Role to optimize (or 'all' for worst 3)")
    parser.add_argument("--iterations", type=int, default=8)
    parser.add_argument("--budget", type=float, default=60,
                        help="Total time budget in minutes")
    args = parser.parse_args()

    if args.action == "audit":
        audit_roles()
    elif args.action == "optimize":
        if args.role == "all":
            # Audit first, then optimize worst 3
            audit_results = audit_roles()
            worst = audit_results[:3]
            per_role = args.budget / len(worst)
            for r in worst:
                log.info("Optimizing: %s (score=%.1f)", r["role"], r["aggregate"])
                optimize_role(r["role"], args.iterations, per_role)
        else:
            optimize_role(args.role, args.iterations, args.budget)


if __name__ == "__main__":
    main()
