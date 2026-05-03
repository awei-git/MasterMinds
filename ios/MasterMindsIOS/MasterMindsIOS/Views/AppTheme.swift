import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

enum AppTheme {
    static let page = Color(hex: 0x1A1A22)
    static let surface = Color(hex: 0x26262F)
    static let paper = Color(hex: 0x32323D)
    static let sidebar = Color(hex: 0x14141B)
    static let line = Color(hex: 0x3A3A46)
    static let ink = Color(hex: 0xF2F2EE)
    static let muted = Color(hex: 0xA0A0AC)
    static let faint = Color(hex: 0x6E6E7A)
    static let accent = Color(hex: 0x8FE5B8)
    static let brass = Color(hex: 0xFFCB6E)
    static let reverseInk = Color(hex: 0x1A1A22)
    static let outBubble = Color(hex: 0x2C4438)
    static let inBubble = Color(hex: 0x1C1C20)
    static let alert = Color(hex: 0xFF9081)
    static let warning = Color(hex: 0xFFA85C)
    static let editorMeasure: CGFloat = 720
    static let displayFace = "ZhiMangXing-Regular"
    static let titleFace = "LXGWWenKai-Regular"
    static let proseFace = "LXGWWenKai-Regular"

    static func display(_ size: CGFloat) -> Font {
        .custom(displayFace, size: size)
    }

    static func title(_ size: CGFloat) -> Font {
        .custom(titleFace, size: size).weight(.semibold)
    }

    static func prose(_ size: CGFloat) -> Font {
        .custom(proseFace, size: size)
    }

    static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(proseFace, size: size).weight(weight)
    }

    static func phaseTint(_ phase: String) -> Color {
        switch phase {
        case "conception": Color(hex: 0xD4A0F0)
        case "bible": Color(hex: 0xA8B8FF)
        case "structure": Color(hex: 0x7FC4F0)
        case "scriptment": Color(hex: 0xFFCB6E)
        case "expansion", "draft", "review", "revision", "final": Color(hex: 0x8FE5B8)
        default: accent
        }
    }

    static func roleTint(_ role: String) -> Color {
        switch role {
        case "idea", "story_architect", "architect", "plot_doctor": Color(hex: 0x7FC4F0)
        case "character", "character_psychologist": Color(hex: 0xFF9DBE)
        case "writer", "bible_writer", "structure_writer", "scriptment_writer", "chapter_writer": Color(hex: 0x8FE5B8)
        case "editor", "style_editor", "market_editor", "scriptment_reviewer", "chapter_editor": Color(hex: 0xFFA85C)
        case "reader": Color(hex: 0xC7A8F0)
        case "continuity", "continuity_editor": Color(hex: 0xA8B8FF)
        case "chronicler": brass
        default: accent
        }
    }
}

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
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
                .font(AppTheme.ui(15, weight: .semibold))
                .foregroundStyle(AppTheme.brass)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(AppTheme.ui(11, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                Text(value)
                    .font(AppTheme.ui(12, weight: .semibold))
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
            .font(AppTheme.ui(11, weight: .semibold))
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
            .font(AppTheme.ui(12, weight: .semibold))
            .foregroundStyle(AppTheme.muted)
            .tracking(1.1)
    }
}

#if canImport(UIKit)
enum KeyboardDismissal {
    @MainActor
    static func dismiss() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

struct KeyboardDoneToolbar: ToolbarContent {
    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .keyboard) {
            Spacer()
            Button("完成") {
                KeyboardDismissal.dismiss()
            }
            .font(AppTheme.ui(15, weight: .semibold))
        }
    }
}
#endif
