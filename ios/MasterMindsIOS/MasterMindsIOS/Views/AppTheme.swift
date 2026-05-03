import SwiftUI

enum AppTheme {
    static let page = Color(.systemGroupedBackground)
    static let surface = Color(.secondarySystemGroupedBackground)
    static let line = Color(.separator).opacity(0.45)
    static let ink = Color.primary
    static let muted = Color.secondary
    static let accent = Color(red: 0.39, green: 0.29, blue: 0.18)

    static func phaseTint(_ phase: String) -> Color {
        switch phase {
        case "conception": Color(red: 0.25, green: 0.33, blue: 0.42)
        case "bible": Color(red: 0.35, green: 0.30, blue: 0.44)
        case "structure": Color(red: 0.28, green: 0.39, blue: 0.34)
        case "scriptment": Color(red: 0.45, green: 0.34, blue: 0.24)
        case "expansion", "draft", "review", "revision", "final": Color(red: 0.42, green: 0.24, blue: 0.22)
        default: accent
        }
    }
}

struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

struct SectionHeaderText: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .tracking(0.8)
    }
}
