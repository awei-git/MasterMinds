import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@main
struct MasterMindsIOSApp: App {
    @StateObject private var appState = AppState()

    init() {
#if canImport(UIKit)
        configureAppearance()
#endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .preferredColorScheme(.dark)
        }
    }

#if canImport(UIKit)
    private func configureAppearance() {
        let listBg = UIColor(red: 0x1A / 255.0, green: 0x1A / 255.0, blue: 0x22 / 255.0, alpha: 1)
        let textPri = UIColor(red: 0xF2 / 255.0, green: 0xF2 / 255.0, blue: 0xEE / 255.0, alpha: 1)
        let textDim = UIColor(red: 0x6E / 255.0, green: 0x6E / 255.0, blue: 0x7A / 255.0, alpha: 1)
        let accent = UIColor(red: 0x8F / 255.0, green: 0xE5 / 255.0, blue: 0xB8 / 255.0, alpha: 1)

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = listBg
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: textPri]
        nav.largeTitleTextAttributes = [.foregroundColor: textPri]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = accent

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = listBg
        tab.shadowColor = .clear
        let item = tab.stackedLayoutAppearance
        item.normal.iconColor = textDim
        item.normal.titleTextAttributes = [.foregroundColor: textDim]
        item.selected.iconColor = accent
        item.selected.titleTextAttributes = [.foregroundColor: accent]
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
#endif
}
