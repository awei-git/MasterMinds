import SwiftUI

enum AppTheme {
    static let page = Color(red: 0.068, green: 0.066, blue: 0.060)
    static let surface = Color(red: 0.110, green: 0.104, blue: 0.092)
    static let paper = Color(red: 0.150, green: 0.138, blue: 0.116)
    static let sidebar = Color(red: 0.086, green: 0.080, blue: 0.070)
    static let line = Color(red: 0.78, green: 0.70, blue: 0.56).opacity(0.23)
    static let ink = Color(red: 0.955, green: 0.925, blue: 0.850)
    static let muted = Color(red: 0.720, green: 0.660, blue: 0.555)
    static let faint = Color(red: 0.505, green: 0.455, blue: 0.370)
    static let accent = Color(red: 0.790, green: 0.615, blue: 0.365)
    static let brass = Color(red: 0.860, green: 0.705, blue: 0.430)
    static let reverseInk = Color(red: 0.055, green: 0.050, blue: 0.044)
    static let editorMeasure: CGFloat = 720

    static func phaseTint(_ phase: String) -> Color {
        switch phase {
        case "conception": Color(red: 0.500, green: 0.650, blue: 0.770)
        case "bible": Color(red: 0.655, green: 0.585, blue: 0.780)
        case "structure": Color(red: 0.545, green: 0.700, blue: 0.565)
        case "scriptment": Color(red: 0.820, green: 0.640, blue: 0.405)
        case "expansion", "draft", "review", "revision", "final": Color(red: 0.820, green: 0.465, blue: 0.400)
        default: accent
        }
    }

    static func roleTint(_ role: String) -> Color {
        switch role {
        case "idea", "story_architect", "architect", "plot_doctor": Color(red: 0.500, green: 0.650, blue: 0.770)
        case "character", "character_psychologist": Color(red: 0.800, green: 0.500, blue: 0.630)
        case "writer", "bible_writer", "structure_writer", "scriptment_writer", "chapter_writer": Color(red: 0.620, green: 0.710, blue: 0.470)
        case "editor", "style_editor", "market_editor", "scriptment_reviewer", "chapter_editor": Color(red: 0.860, green: 0.590, blue: 0.390)
        case "reader": Color(red: 0.545, green: 0.700, blue: 0.565)
        case "continuity", "continuity_editor": Color(red: 0.655, green: 0.585, blue: 0.780)
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
            .foregroundStyle(AppTheme.ink)
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
                    .foregroundStyle(AppTheme.muted)
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
            .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(color.opacity(0.26))
            }
    }
}

struct SectionHeaderText: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(AppTheme.muted)
            .tracking(1.1)
    }
}
