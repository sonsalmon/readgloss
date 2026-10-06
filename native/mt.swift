// 상주 번역 도우미. stdin 한 줄 JSON {"text": "..."} -> stdout 한 줄 JSON {"translation": "..."} 또는 {"error": "not-installed"|"failed"}.
// macOS 26 의 Translation 프레임워크(영어->한국어, 기기 안에서 번역). 세션은 한 번 만들어 재사용한다(첫 호출은 모델 적재로 수 초).
import Foundation
import Translation

func emit(_ obj: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"error\":\"failed\"}".utf8)
  FileHandle.standardOutput.write(data + Data("\n".utf8))
}

func textOf(_ line: String) -> String? {
  guard let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
        let t = o["text"] as? String, !t.isEmpty, t.count <= 1000 else { return nil }
  return t
}

@main struct MT {
  static func main() async {
    let en = Locale.Language(identifier: "en"), ko = Locale.Language(identifier: "ko")
    if #available(macOS 26.0, *), await LanguageAvailability().status(from: en, to: ko) == .installed {
      let session = TranslationSession(installedSource: en, target: ko)
      while let line = readLine() {
        guard let text = textOf(line) else { emit(["error": "failed"]); continue }
        do { emit(["translation": try await session.translate(text).targetText]) } catch { emit(["error": "failed"]) }
      }
    } else {
      while readLine() != nil { emit(["error": "not-installed"]) } // 언어팩이 없거나 macOS 26 미만
    }
  }
}
