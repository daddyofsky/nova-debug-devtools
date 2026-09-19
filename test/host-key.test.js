/*
 * lib/protocol.js 호스트 키 정규화/매칭 회귀 테스트
 *
 * 실행: node test/host-key.test.js
 */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ctx = vm.createContext({ self: {}, URL, console, RegExp, Object });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "lib/protocol.js"), "utf8"), ctx);
const P = ctx.self.NovaDebugProtocol;

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log("  PASS  " + name);
    return;
  }
  failures++;
  console.log("  FAIL  " + name + "\n        기대 " + JSON.stringify(expected) + " / 실제 " + JSON.stringify(actual));
}

console.log("\n[normalizeHostKey] 언더스코어가 든 호스트명");
check("정확 호스트", P.normalizeHostKey("nova_builder.zzz"), "nova_builder.zzz");
check("선행 와일드카드", P.normalizeHostKey("*.nova_builder.zzz"), "*.nova_builder.zzz");
check("라벨 내 와일드카드", P.normalizeHostKey("dev_*.nova_builder.zzz"), "dev_*.nova_builder.zzz");
check("대문자 소문자화", P.normalizeHostKey("*.Nova_Builder.ZZZ"), "*.nova_builder.zzz");

console.log("\n[normalizeHostKey] 거부해야 하는 입력");
check("전체 허용 *", P.normalizeHostKey("*"), null);
check("전체 허용 *.*", P.normalizeHostKey("*.*"), null);
check("구분자만 *._", P.normalizeHostKey("*._"), null);
check("빈 라벨 *.foo..bar", P.normalizeHostKey("*.foo..bar"), null);
check("허용하지 않는 문자", P.normalizeHostKey("*.foo bar.com"), null);

console.log("\n[매칭] *.nova_builder.zzz");
const re = P.hostKeyToRegExp("*.nova_builder.zzz");
check("apex 매칭", re.test("nova_builder.zzz"), true);
check("서브도메인 매칭", re.test("api.nova_builder.zzz"), true);
check("깊은 서브도메인 매칭", re.test("a.b.nova_builder.zzz"), true);
check("하이픈 변형 비매칭", re.test("nova-builder.zzz"), false);

console.log("\n[findHostEntry] 패턴 키로 조회");
const hostMap = { "*.nova_builder.zzz": { enabled: true } };
check(
  "패턴 항목 반환",
  P.findHostEntry("api.nova_builder.zzz", hostMap),
  { key: "*.nova_builder.zzz", entry: { enabled: true } }
);
check("무관 호스트는 null", P.findHostEntry("other.zzz", hostMap), null);

console.log(failures ? "\n실패 " + failures + "건" : "\n전체 통과");
process.exit(failures ? 1 : 0);
