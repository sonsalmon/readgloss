// 상주 사전 도우미. stdin 한 줄 = 단어 하나, stdout 한 줄 = JSON. 맥 내장 뉴에이스 영한사전을 조회한다.
// 비공개 함수 시그니처는 mattt/DictionaryKit(TTTDictionary.m)의 extern 선언을 따랐다.
import Foundation
import CoreServices

typealias CopyAvail = @convention(c) () -> Unmanaged<CFSet>?
typealias GetName = @convention(c) (AnyObject) -> Unmanaged<CFString>?
typealias CopyRecords = @convention(c) (AnyObject, CFString, UnsafeMutableRawPointer?, UnsafeMutableRawPointer?) -> Unmanaged<CFArray>?
typealias RecGetHeadword = @convention(c) (AnyObject) -> Unmanaged<CFString>?
typealias RecCopyData = @convention(c) (AnyObject, Int) -> Unmanaged<CFString>?

let lib = dlopen("/System/Library/Frameworks/CoreServices.framework/Frameworks/DictionaryServices.framework/DictionaryServices", RTLD_NOW)
func sym<T>(_ name: String, _ type: T.Type) -> T? {
  guard let lib = lib, let p = dlsym(lib, name) else { return nil }
  return unsafeBitCast(p, to: type)
}
let copyAvail = sym("DCSCopyAvailableDictionaries", CopyAvail.self)
let getName = sym("DCSDictionaryGetName", GetName.self)
let copyRecords = sym("DCSCopyRecordsForSearchString", CopyRecords.self)
let recHeadword = sym("DCSRecordGetHeadword", RecGetHeadword.self)
let recData = sym("DCSRecordCopyData", RecCopyData.self)
let TEXT_VERSION = 3

// 영한사전: 이름에 "영한"이 든 사전. 못 찾으면 nil(기본 사전 순서로 조회)
var target: AnyObject? = nil
if let list = copyAvail?()?.takeRetainedValue() as? Set<NSObject> {
  for d in list where (getName?(d)?.takeUnretainedValue() as String? ?? "").contains("영한") { target = d }
}

func defText(_ w: String) -> String? {
  let r = CFRange(location: 0, length: (w as NSString).length)
  let dict = target.map { unsafeBitCast($0, to: DCSDictionary.self) }
  return DCSCopyTextDefinition(dict, w as CFString, r)?.takeRetainedValue() as String?
}

func records(_ w: String) -> [(headword: String, text: String)] {
  guard let t = target, let list = copyRecords?(t, w as CFString, nil, nil)?.takeRetainedValue() as? [AnyObject] else { return [] }
  return list.compactMap { rec in
    guard let h = recHeadword?(rec)?.takeUnretainedValue() as String?,
          let text = recData?(rec, TEXT_VERSION)?.takeRetainedValue() as String? else { return nil }
    return (h, text)
  }
}

// "ex·ploit 1 | éksplɔit | 명사…" 의 표제어 부분("ex·ploit 1")에서 번호를 뽑는다. 없으면 0.
func homograph(_ text: String) -> Int {
  let head = text.components(separatedBy: " | ").first ?? ""
  guard let last = head.split(separator: " ").last, let n = Int(last) else { return 0 }
  return n
}

// 조회: 레코드 검색은 굴절형(delves)도 원형 레코드를 돌려주고, 같은 철자 표제어(exploit 1·2)를 모두 준다.
// 레코드 함수를 못 쓰거나 결과가 비면 공개 함수의 첫 표제어만 돌려준다.
func lookup(_ w: String) -> [[String: Any]] {
  var recs = records(w)
  if recs.isEmpty, let d = defText(w) { recs = [(w, d)] }
  return recs.map { ["headword": $0.headword, "homograph": homograph($0.text), "text": $0.text] }
}

let OK = try! NSRegularExpression(pattern: "^[A-Za-z]+(?:['’-][A-Za-z]+)*$")
func valid(_ s: String) -> Bool {
  s.utf16.count <= 200 && OK.firstMatch(in: s, range: NSRange(location: 0, length: s.utf16.count)) != nil
}

func emit(_ obj: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{\"found\":false}".utf8)
  FileHandle.standardOutput.write(data + Data("\n".utf8))
}

while let line = readLine() {
  let w = line.trimmingCharacters(in: .whitespacesAndNewlines)
  guard valid(w) else { emit(["found": false]); continue }
  let entries = lookup(w)
  emit(entries.isEmpty ? ["found": false] : ["found": true, "entries": entries])
}
