import Foundation

enum APIClientError: LocalizedError {
    case invalidBaseURL(String)
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let value):
            "Invalid server URL: \(value)"
        case .invalidResponse:
            "Invalid server response"
        case .server(let message):
            message
        }
    }
}

struct MasterMindsAPI {
    let baseURLString: String

    private var baseURL: URL {
        get throws {
            guard let url = URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                throw APIClientError.invalidBaseURL(baseURLString)
            }
            return url
        }
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    func projects() async throws -> [Project] {
        try await request(path: "/api/projects", method: "GET")
    }

    func workflow() async throws -> WorkflowResponse {
        try await request(path: "/api/workflow", method: "GET")
    }

    func createProject(title: String, type: String) async throws -> Project {
        try await request(
            path: "/api/projects",
            method: "POST",
            body: ["title": title, "type": type]
        )
    }

    func setPhase(slug: String, phase: String) async throws -> Project {
        try await request(
            path: "/api/projects",
            method: "PATCH",
            body: ["slug": slug, "action": "setPhase", "phase": phase]
        )
    }

    func phaseSummary(projectSlug: String, phase: String) async throws -> String? {
        let response: PhaseSummaryResponse = try await request(
            path: "/api/phases",
            method: "GET",
            query: ["projectSlug": projectSlug, "phase": phase]
        )
        return response.content
    }

    func runWritingTask(
        projectSlug: String,
        kind: String,
        provider: String = "claude-code",
        chapterId: String? = nil,
        instruction: String? = nil
    ) async throws -> WritingTaskResult {
        try await request(
            path: "/api/writing-tasks",
            method: "POST",
            body: WritingTaskPayload(
                projectSlug: projectSlug,
                kind: kind,
                provider: provider,
                instruction: instruction,
                chapterId: chapterId
            )
        )
    }

    func chapters(projectSlug: String) async throws -> [ChapterUnit] {
        let response: ChapterListResponse = try await request(
            path: "/api/beats",
            method: "GET",
            query: ["projectSlug": projectSlug, "unit": "chapter"]
        )
        return response.beats
    }

    func chapterDraft(projectSlug: String, chapterId: String) async throws -> SavedArtifactResponse {
        try await request(
            path: "/api/writing-tasks",
            method: "GET",
            query: ["projectSlug": projectSlug, "kind": "chapter_draft", "chapterId": chapterId]
        )
    }

    func saveChapterDraft(projectSlug: String, chapterId: String, content: String) async throws -> SaveArtifactResponse {
        try await request(
            path: "/api/writing-tasks",
            method: "PATCH",
            body: SaveWritingTaskPayload(
                projectSlug: projectSlug,
                kind: "chapter_draft",
                chapterId: chapterId,
                content: content
            )
        )
    }

    func roundtable(
        projectSlug: String,
        phase: String,
        topic: String,
        provider: String = "claude-code",
        maxRounds: Int = 2,
        generateSummary: Bool = false
    ) -> AsyncThrowingStream<RoundtableEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = try makeRequest(path: "/api/roundtable", method: "POST")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.httpBody = try encoder.encode(RoundtablePayload(
                        projectSlug: projectSlug,
                        phase: phase,
                        topic: topic,
                        provider: provider,
                        maxRounds: maxRounds,
                        generateSummary: generateSummary
                    ))

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    try validate(response: response, body: Data())

                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        if let event = try decodeSSELine(line) {
                            continuation.yield(event)
                            if event.type == "done" || event.type == "error" {
                                continuation.finish()
                                return
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private func request<T: Decodable>(
        path: String,
        method: String,
        query: [String: String] = [:]
    ) async throws -> T {
        let request = try makeRequest(path: path, method: method, query: query)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, body: data)
        return try decoder.decode(T.self, from: data)
    }

    private func request<T: Decodable, Body: Encodable>(
        path: String,
        method: String,
        query: [String: String] = [:],
        body: Body
    ) async throws -> T {
        var request = try makeRequest(path: path, method: method, query: query)
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, body: data)
        return try decoder.decode(T.self, from: data)
    }

    private func makeRequest(path: String, method: String, query: [String: String] = [:]) throws -> URLRequest {
        let root = try baseURL
        guard var components = URLComponents(url: root.appending(path: path), resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidBaseURL(baseURLString)
        }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else {
            throw APIClientError.invalidBaseURL(baseURLString)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func validate(response: URLResponse, body: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if let error = try? decoder.decode(APIErrorResponse.self, from: body) {
                throw APIClientError.server(error.error)
            }
            throw APIClientError.server("HTTP \(http.statusCode)")
        }
    }

    func decodeSSELine(_ line: String) throws -> RoundtableEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload: String
        if trimmed.hasPrefix("data: ") {
            payload = String(trimmed.dropFirst(6))
        } else if trimmed.hasPrefix("data:") {
            payload = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
        } else {
            return nil
        }
        guard !payload.isEmpty, payload != "[DONE]" else { return nil }
        guard let data = payload.data(using: .utf8) else { return nil }
        return try decoder.decode(RoundtableEvent.self, from: data)
    }
}

private struct RoundtablePayload: Encodable {
    let projectSlug: String
    let phase: String
    let topic: String
    let provider: String
    let maxRounds: Int
    let generateSummary: Bool
}

private struct WritingTaskPayload: Encodable {
    let projectSlug: String
    let kind: String
    let provider: String
    let instruction: String?
    let chapterId: String?
}

private struct SaveWritingTaskPayload: Encodable {
    let projectSlug: String
    let kind: String
    let chapterId: String
    let content: String
}
