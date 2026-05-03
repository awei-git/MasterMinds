import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState
    @State private var serverURL = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("神仙会 Web Server") {
                    TextField(AppState.defaultServerBaseURL, text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Text("真机不能使用 localhost。Mac 端请用 `pnpm dev:lan` 启动，然后填写 Mac 的局域网地址。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("快速设置") {
                    Button("使用当前 Mac 地址") {
                        serverURL = AppState.defaultServerBaseURL
                    }
                    Button("Simulator localhost") {
                        serverURL = "http://localhost:3000"
                    }
                }
            }
            .navigationTitle("服务器")
            .onAppear {
                serverURL = appState.serverBaseURL
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        appState.serverBaseURL = serverURL
                        Task { await appState.checkConnection() }
                        dismiss()
                    }
                }
            }
        }
    }
}
