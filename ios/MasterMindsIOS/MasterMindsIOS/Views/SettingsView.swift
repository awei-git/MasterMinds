import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appState: AppState
    @State private var serverURL = ""
    @State private var writingLanguage = "zh"
    @State private var providerSettings = ModelProviderSettings.defaults

    var body: some View {
        NavigationStack {
            Form {
                Section("神仙会 Web Server") {
                    TextField(AppState.defaultServerBaseURL, text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    Text("真机不能使用 localhost。Mac 端请用 `pnpm dev:lan` 启动，然后填写 Mac 的局域网地址。")
                        .font(AppTheme.prose(13))
                        .foregroundStyle(AppTheme.muted)
                }

                Section("快速设置") {
                    Button("使用当前 Mac 地址") {
                        serverURL = AppState.defaultServerBaseURL
                    }
                    Button("Simulator localhost") {
                        serverURL = "http://localhost:3000"
                    }
                }

                Section("iCloud") {
                    HStack {
                        Text("同步状态")
                        Spacer()
                        Text(cloudStatus)
                            .foregroundStyle(AppTheme.muted)
                    }
                    Text("项目、阶段、章节结构和章节草稿会写入当前 Apple ID 的 iCloud Key-Value Store。同步不是实时协作；离线编辑后会在网络恢复时慢同步。")
                        .font(AppTheme.prose(13))
                        .foregroundStyle(AppTheme.muted)
                    Button("检查 iCloud") {
                        Task { await appState.checkCloudSync() }
                    }
                }

                Section("模型默认值") {
                    Picker("写作语言", selection: $writingLanguage) {
                        Text("中文").tag("zh")
                        Text("英文").tag("en")
                    }
                    ProviderPicker(title: "Idea", selection: $providerSettings.ideaProvider)
                    ProviderPicker(title: "结构", selection: $providerSettings.structureProvider)
                    ProviderPicker(title: "审查", selection: $providerSettings.reviewProvider)
                    ProviderPicker(title: "中文写作", selection: $providerSettings.chineseWritingProvider)
                    ProviderPicker(title: "英文写作", selection: $providerSettings.englishWritingProvider)
                    Text("默认路由：idea 用 GPT，结构用 Claude，审查用 Gemini；写作按语言选择 DeepSeek 或 GPT。")
                        .font(AppTheme.prose(13))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("设置")
            .onAppear {
                serverURL = appState.serverBaseURL
                writingLanguage = appState.writingLanguage
                providerSettings = appState.providerSettings
                Task { await appState.checkCloudSync() }
            }
            .toolbar {
#if canImport(UIKit)
                KeyboardDoneToolbar()
#endif
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        appState.serverBaseURL = serverURL
                        appState.writingLanguage = writingLanguage
                        appState.providerSettings = providerSettings
                        Task { await appState.checkConnection() }
                        dismiss()
                    }
                }
            }
        }
    }

    private var cloudStatus: String {
        switch appState.cloudSyncState {
        case .unknown: "未检查"
        case .checking: "检查中"
        case .available: "可用"
        case .syncing: "同步中"
        case .unavailable(let message): message
        }
    }
}

private struct ProviderPicker: View {
    let title: String
    @Binding var selection: String

    private let providers = [
        ("gpt", "GPT"),
        ("claude-code", "Claude"),
        ("deepseek", "DeepSeek"),
        ("gemini", "Gemini"),
        ("local", "Local"),
    ]

    var body: some View {
        Picker(title, selection: $selection) {
            ForEach(providers, id: \.0) { provider in
                Text(provider.1).tag(provider.0)
            }
        }
    }
}
