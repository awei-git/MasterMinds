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

    @Test func roundtableSSEDataLineDecodesImmediately() throws {
        let api = MasterMindsAPI(baseURLString: "http://127.0.0.1:3000")
        let event = try api.decodeSSELine(#"data: {"type":"roundtable_start","discussionId":"d1","phase":"conception","topic":"开场问题","roles":["architect"],"role":null,"label":null,"round":null,"error":null,"message":null}"#)

        #expect(event?.type == "roundtable_start")
        #expect(event?.discussionId == "d1")
        #expect(event?.topic == "开场问题")
        #expect(event?.roles == ["architect"])
    }

    @Test func roundtableSSEIgnoresNonDataLines() throws {
        let api = MasterMindsAPI(baseURLString: "http://127.0.0.1:3000")

        #expect(try api.decodeSSELine("") == nil)
        #expect(try api.decodeSSELine("event: message") == nil)
        #expect(try api.decodeSSELine("data: [DONE]") == nil)
    }
}
