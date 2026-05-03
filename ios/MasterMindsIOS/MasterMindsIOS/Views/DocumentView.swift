import SwiftUI

struct DocumentView: View {
    let title: String
    let content: String

    var body: some View {
        ScrollView {
            Text(content)
                .font(AppTheme.prose(17))
                .lineSpacing(6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(22)
        }
        .background(AppTheme.page)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
