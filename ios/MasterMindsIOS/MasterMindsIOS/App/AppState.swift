import Foundation

enum ServerConnectionState: Equatable {
    case unknown
    case checking
    case online
    case offline(String)
}

@MainActor
final class AppState: ObservableObject {
    @Published var serverBaseURL: String {
        didSet {
            UserDefaults.standard.set(serverBaseURL, forKey: Self.serverKey)
            api = MasterMindsAPI(baseURLString: serverBaseURL)
            connectionState = .unknown
        }
    }

    @Published var api: MasterMindsAPI
    @Published var lastError: String?
    @Published var connectionState: ServerConnectionState = .unknown

    private static let serverKey = "serverBaseURL"
    static let defaultServerBaseURL = "http://192.168.1.232:3000"

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let baseURL: String
        if let saved, !saved.isEmpty, !Self.isDeviceLocalhost(saved) {
            baseURL = saved
        } else {
            baseURL = Self.defaultServerBaseURL
            UserDefaults.standard.set(baseURL, forKey: Self.serverKey)
        }
        serverBaseURL = baseURL
        api = MasterMindsAPI(baseURLString: baseURL)
    }

    private static func isDeviceLocalhost(_ url: String) -> Bool {
        url == "http://localhost:3000"
            || url == "https://localhost:3000"
            || url == "http://127.0.0.1:3000"
            || url == "https://127.0.0.1:3000"
    }

    func checkConnection() async {
        connectionState = .checking
        do {
            _ = try await api.projects()
            connectionState = .online
        } catch {
            connectionState = .offline(error.localizedDescription)
        }
    }
}
