import Testing
@testable import MasterMindsIOS

struct WorkflowTests {
    @Test func legacyPhasesMapToExpansion() {
        #expect(Workflow.phaseLabel("draft") == "逐章扩写")
        #expect(Workflow.phaseLabel("review") == "逐章扩写")
        #expect(Workflow.phaseLabel("final") == "逐章扩写")
    }

    @Test func writingTasksMatchPlanPhases() {
        #expect(Workflow.writingTasks(for: "conception").isEmpty)
        #expect(Workflow.writingTasks(for: "bible").map(\.kind) == ["bible_draft", "bible_revision"])
        #expect(Workflow.writingTasks(for: "structure").map(\.kind) == ["beat_sheet", "beat_revision"])
        #expect(Workflow.writingTasks(for: "scriptment").map(\.kind) == ["scriptment", "scriptment_revision"])
        #expect(Workflow.writingTasks(for: "expansion").map(\.kind) == ["full_review_plan"])
    }
}
