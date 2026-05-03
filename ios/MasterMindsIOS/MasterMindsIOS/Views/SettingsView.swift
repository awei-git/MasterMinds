import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState
    @State private var serverURL = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("神仙会 Web Server") {
                    TextField("http://localhost:3000", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Text("Simulator 可用 localhost；真机请填 Mac 的局域网地址，例如 http://192.168.1.232:3000。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
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
                        dismiss()
                    }
                }
            }
        }
    }
}
