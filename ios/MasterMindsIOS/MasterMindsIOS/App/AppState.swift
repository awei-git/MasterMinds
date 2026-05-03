import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var serverBaseURL: String {
        didSet {
            UserDefaults.standard.set(serverBaseURL, forKey: Self.serverKey)
            api = MasterMindsAPI(baseURLString: serverBaseURL)
        }
    }

    @Published var api: MasterMindsAPI
    @Published var lastError: String?

    private static let serverKey = "serverBaseURL"

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.serverKey)
        let baseURL = saved?.isEmpty == false ? saved! : "http://localhost:3000"
        serverBaseURL = baseURL
        api = MasterMindsAPI(baseURLString: baseURL)
    }
}
