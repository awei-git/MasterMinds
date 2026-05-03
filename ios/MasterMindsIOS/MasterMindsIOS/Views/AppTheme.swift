import SwiftUI

enum AppTheme {
    static let page = Color(red: 0.965, green: 0.957, blue: 0.940)
    static let surface = Color(red: 0.992, green: 0.988, blue: 0.976)
    static let paper = Color(red: 1.000, green: 0.997, blue: 0.988)
    static let sidebar = Color(red: 0.925, green: 0.913, blue: 0.890)
    static let line = Color(red: 0.72, green: 0.69, blue: 0.63).opacity(0.42)
    static let ink = Color.primary
    static let muted = Color.secondary
    static let accent = Color(red: 0.23, green: 0.20, blue: 0.16)
    static let brass = Color(red: 0.58, green: 0.43, blue: 0.24)
    static let editorMeasure: CGFloat = 720

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

    static func roleTint(_ role: String) -> Color {
        switch role {
        case "idea", "story_architect", "architect", "plot_doctor": Color(red: 0.25, green: 0.33, blue: 0.42)
        case "character", "character_psychologist": Color(red: 0.42, green: 0.24, blue: 0.31)
        case "writer", "bible_writer", "structure_writer", "scriptment_writer", "chapter_writer": Color(red: 0.36, green: 0.39, blue: 0.28)
        case "editor", "style_editor", "market_editor", "scriptment_reviewer", "chapter_editor": Color(red: 0.50, green: 0.32, blue: 0.22)
        case "reader": Color(red: 0.28, green: 0.39, blue: 0.34)
        case "continuity", "continuity_editor": Color(red: 0.35, green: 0.30, blue: 0.44)
        case "chronicler": brass
        default: accent
        }
    }
}

struct SurfacePanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(14)
            .background(AppTheme.surface)
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.line)
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct MetricTile: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(AppTheme.brass)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
            }
        }
    }
}

struct ThinProgress: View {
    let value: Double
    let color: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle().fill(AppTheme.line.opacity(0.45))
                Rectangle()
                    .fill(color)
                    .frame(width: max(4, proxy.size.width * min(max(value, 0), 1)))
            }
        }
        .frame(height: 3)
        .clipShape(Capsule())
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
            .tracking(1.1)
    }
}
