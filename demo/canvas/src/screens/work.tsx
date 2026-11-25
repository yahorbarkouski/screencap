import React from "react";
import { Lights } from "../../../resume/src/apps";
import { Browser, ink, mono, part, ui } from "./kit";

type Said = { you?: string; say?: string; tool?: [string, string]; code?: string[]; bad?: string; good?: string };

const lexer: Said[] = [
  { you: "mira wants a failing test before the fix. Add it and run it." },
  { say: "I'll add the test first, so we can watch it fail." },
  { tool: ["Edit", "tests/tokenize.rs"], code: ["#[test]", "fn nested_quotes() {", '  let s = r#""say \\"hi\\" twice""#;', "  assert_eq!(tokenize(s).len(), 1);", "}"] },
  { tool: ["Run", "cargo test nested"], bad: "1 failed: nested_quotes" },
  { say: "It fails as mira described: the string ends at the first escaped quote." },
  { you: "Good. Fix it in the lexer, not in the parser." },
  { tool: ["Edit", "src/lexer.rs"], code: ["match (state, c) {", "  (Str, '\\\\') => state = Escape,", "  (Escape, _)  => state = Str,"] },
  { tool: ["Run", "cargo test"], good: "128 passed" },
  { say: "All green. The escape is now a state of its own, so quotes nest to any depth." },
];

const kyoto: Said[] = [
  { you: "Plan three day trips from Kyoto for April." },
  { say: "Nara: the deer park and Tōdai-ji, 45 minutes by train." },
  { say: "Arashiyama: the bamboo grove, best before eight, then the river." },
  { say: "Uji: tea houses along the water, and Byōdō-in before it closes." },
  { you: "Which one if it rains?" },
  { say: "Uji. Most of it is under a roof, and the tea is better in the rain." },
];

export function Claude({ kind, p }: { kind: "lexer" | "kyoto"; p: number }) {
  const all = kind === "lexer" ? lexer : kyoto;
  const said = all.slice(0, Math.max(2, Math.round(1 + p * (all.length - 1)) + 1)).slice(-5);
  const sessions = ["Plan Kyoto day trips", "Fix tokenizer for nested quotes", "Write release notes 0.9", "Draft offsite agenda", "Benchmark the lexer", "Port config to TOML", "Answer issue #477", "Review take-home"];
  const title = kind === "lexer" ? sessions[1] : sessions[0];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#262624", color: ink.text, fontFamily: ui }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 250, background: "#1f1e1d" }}>
        <Lights active x={15} y={15} />
        <div style={{ position: "absolute", left: 14, right: 14, top: 50, height: 36, borderRadius: 9, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 15, color: ink.secondary }}>+ New session</div>
        {sessions.map((s, i) => (
          <div key={s} style={{ position: "absolute", left: 12, right: 12, top: 104 + i * 44, height: 38, borderRadius: 9, padding: "0 12px", display: "flex", alignItems: "center", fontSize: 14.5, background: s === title ? "rgba(255,255,255,0.1)" : "transparent", color: s === title ? ink.text : ink.secondary, whiteSpace: "nowrap", overflow: "hidden" }}>{s}</div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 250, right: 0, top: 0, bottom: 0 }}>
        <div style={{ height: 50, borderBottom: `1px solid ${ink.hairline}`, display: "flex", alignItems: "center", padding: "0 26px", fontSize: 16, fontWeight: 600 }}>{title}</div>
        <div style={{ position: "absolute", left: 26, right: 26, top: 64, bottom: 78, display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 15, fontSize: 18, lineHeight: 1.45, overflow: "hidden" }}>
          {said.map((m, i) =>
            m.you ? (
              <div key={i} style={{ alignSelf: "flex-end", maxWidth: "76%", background: "#3a3a37", borderRadius: 14, padding: "10px 16px" }}>{m.you}</div>
            ) : m.tool ? (
              <div key={i} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 11, overflow: "hidden", fontSize: 15.5, flex: "none" }}>
                <div style={{ padding: "7px 14px", background: "rgba(255,255,255,0.05)", color: ink.secondary }}>
                  <b style={{ color: ink.text }}>{m.tool[0]}</b> <span style={{ fontFamily: mono }}>{m.tool[1]}</span>
                </div>
                {m.code?.map((line, k) => (
                  <div key={k} style={{ fontFamily: mono, fontSize: 14.5, background: "rgba(46,160,67,0.17)", color: "#aff5b4", padding: "1px 14px", whiteSpace: "pre" }}>+ {line}</div>
                ))}
                {m.bad && <div style={{ padding: "7px 14px", fontFamily: mono, color: "#ff9492" }}>{m.bad}</div>}
                {m.good && <div style={{ padding: "7px 14px", fontFamily: mono, color: "#7ee787" }}>{m.good}</div>}
              </div>
            ) : (
              <div key={i}>{m.say}</div>
            ),
          )}
        </div>
        <div style={{ position: "absolute", left: 26, right: 26, bottom: 18, height: 46, borderRadius: 14, background: "#30302e", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", padding: "0 18px", fontSize: 16, color: ink.tertiary }}>Reply to Claude…</div>
      </div>
    </div>
  );
}

export function PullRequest({ p }: { p: number }) {
  const step = Math.round(p * 5);
  const merged = step >= 5, green = step >= 4;
  const thread: [string, React.ReactNode][] = [
    ["mira", "The fix looks right. Can you add a test for a quote inside a quote first?"],
    ["jules", "Added in the second commit. It fails without the lexer change."],
    ["mira", "Lovely. One more: what happens at the end of the file?"],
    ["jules", "It reports an open string now, with the line it started on."],
    ["mira", "Approved. Ship it."],
  ];
  return (
    <Browser place="pr">
      <div style={{ position: "absolute", inset: 0, background: "#0d1117", padding: "24px 44px", fontSize: 17 }}>
        <div style={{ color: ink.secondary, marginBottom: 8 }}>acme / <b style={{ color: ink.text }}>tokenizer</b></div>
        <div style={{ fontSize: 30, fontWeight: 600, marginBottom: 12 }}>
          Fix nested quotes <span style={{ color: ink.tertiary, fontWeight: 400 }}>#482</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, color: ink.secondary }}>
          <span style={{ background: merged ? "#8957e5" : "#238636", color: "#fff", borderRadius: 16, padding: "5px 15px", fontWeight: 600 }}>{merged ? "Merged" : "Open"}</span>
          jules wants to merge {2 + Math.min(step, 3)} commits
        </div>
        <div>
          {thread.slice(0, Math.max(1, step)).slice(-2).map(([who, text], i) => (
            <div key={i} style={{ border: "1px solid #30363d", borderRadius: 10, overflow: "hidden", marginBottom: 13 }}>
              <div style={{ background: "#161b22", padding: "8px 16px", color: ink.secondary }}><b style={{ color: ink.text }}>{who}</b> commented</div>
              <div style={{ padding: "12px 16px", lineHeight: 1.5 }}>{text}</div>
            </div>
          ))}
          <div style={{ border: "1px solid #30363d", borderRadius: 10, padding: "13px 16px", display: "flex", gap: 12 }}>
            <span style={{ color: green ? "#3fb950" : "#f85149", fontWeight: 700 }}>{green ? "✓" : "✕"}</span>
            <span><b>cargo test</b> <span style={{ color: ink.secondary }}>· {green ? "all checks passed" : "1 failing check"}</span></span>
          </div>
        </div>
      </div>
    </Browser>
  );
}

export function Terminal({ p }: { p: number }) {
  const lines: [string, string?][] = [
    ["~/code/tokenizer ❯ cargo test nested", "#7ee787"], ["running 3 tests"], ["test splits_on_spaces ... ok", "#7ee787"], ["test keeps_single_quotes ... ok", "#7ee787"],
    ["test nested_quotes ... FAILED", "#ff7b72"], ['  left: ["say \\"hi", "twice\\""]'], [' right: ["say \\"hi\\" twice"]'], ["test result: FAILED. 2 passed; 1 failed", "#ff7b72"],
    ["~/code/tokenizer ❯ cargo test nested", "#7ee787"], ["test nested_quotes ... ok", "#7ee787"], ["test result: ok. 3 passed", "#7ee787"],
    ["~/code/tokenizer ❯ cargo test", "#7ee787"], ["running 128 tests"], ["test result: ok. 128 passed; 0 failed", "#7ee787"],
    ["~/code/tokenizer ❯ git tag v0.9.0", "#7ee787"], ["~/code/tokenizer ❯ git push --tags", "#7ee787"], [" * [new tag]   v0.9.0 -> v0.9.0"], ["~/code/tokenizer ❯ █", "#7ee787"],
  ];
  const count = Math.max(4, Math.round(p * lines.length));
  return (
    <div style={{ position: "absolute", inset: 0, background: "#16171b", color: "#d6d9de", fontFamily: ui }}>
      <Lights active x={15} y={13} />
      <div style={{ textAlign: "center", fontSize: 15, color: ink.secondary, paddingTop: 10 }}>tokenizer — cargo test</div>
      <div style={{ fontFamily: mono, fontSize: 21, lineHeight: 1.62, padding: "16px 34px" }}>
        {lines.slice(0, count).slice(-14).map(([text, color], i) => (
          <div key={i} style={{ color, whiteSpace: "pre" }}>{text}</div>
        ))}
      </div>
    </div>
  );
}

export function Grammar({ p }: { p: number }) {
  return (
    <Browser place="grammar" light>
      <div style={{ display: "flex", color: "#24292f", transform: `translateY(${-p * 260}px)` }}>
        <div style={{ width: 220, padding: "30px 26px", fontSize: 16, lineHeight: 2.1, color: "#57606a" }}>
          <b style={{ color: "#24292f" }}>Strings</b>
          {["Quotes", "Escapes", "Raw strings", "Nesting", "Errors"].map((s) => (
            <div key={s} style={{ color: s === "Escapes" ? "#0969da" : undefined }}>{s}</div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "30px 60px 0 20px", fontSize: 18.5, lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 12 }}>Escapes</div>
          <p style={{ margin: "0 0 16px" }}>A backslash takes the next character out of the grammar. The lexer must remember that it saw one.</p>
          <Code lines={["string  = '\"' { char | escape } '\"'", "escape  = '\\' any", "char    = any - '\"' - '\\'"]} />
          <p style={{ margin: "18px 0" }}>With one state for escapes, quotes nest to any depth. Without it, a string ends at the first quote it meets.</p>
          <div style={{ fontSize: 26, fontWeight: 700, margin: "8px 0 12px" }}>As a machine</div>
          <svg width={620} height={170}>
            {[["Text", 90], ["Str", 300], ["Escape", 510]].map(([n, x]) => (
              <g key={n as string} transform={`translate(${x} 86)`}>
                <circle r={50} fill="#eef4ff" stroke="#0969da" strokeWidth={2.5} />
                <text textAnchor="middle" y={7} fontSize={20} fontFamily={ui} fill="#0a3069">{n}</text>
              </g>
            ))}
            <path d="M142 74 Q195 46 248 74 M248 98 Q195 126 142 98 M352 74 Q405 46 458 74 M458 98 Q405 126 352 98" stroke="#57606a" strokeWidth={2.5} fill="none" />
          </svg>
          <Code lines={["(Text,   '\"')  => Str", "(Str,    '\\')  => Escape", "(Escape, _)    => Str"]} />
        </div>
      </div>
    </Browser>
  );
}

function Code({ lines }: { lines: string[] }) {
  return (
    <div style={{ background: "#f6f8fa", borderRadius: 10, padding: "14px 20px", fontFamily: mono, fontSize: 17, lineHeight: 1.6 }}>
      {lines.map((l) => (
        <div key={l} style={{ whiteSpace: "pre" }}>{l}</div>
      ))}
    </div>
  );
}

export function Roadmap({ p }: { p: number }) {
  const items = ["Typo tolerance", "Synonyms", "Faceted filters", "Federated search", "Saved searches", "Search in comments"];
  const cut = part(p, 0.4, 1);
  return (
    <Browser place="roadmap" light>
      <div style={{ position: "absolute", inset: 0, background: "#f0f1f4", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 660, background: "#fff", boxShadow: "0 1px 5px rgba(0,0,0,0.14)", padding: "46px 70px", color: "#1f2328", fontSize: 20, lineHeight: 1.75, transform: `translateY(${18 - p * 40}px)` }}>
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.2, marginBottom: 8 }}>Q4 roadmap</div>
          <div style={{ color: "#6e7681", marginBottom: 14 }}>{p < 0.4 ? "Draft" : p < 0.8 ? "In review" : "Agreed"}</div>
          <div style={{ fontSize: 25, fontWeight: 650 }}>Search</div>
          {items.map((t, i) => {
            const gone = i > 2 && cut * 3 > i - 3;
            return (
              <div key={t} style={{ color: gone ? "#a0a6ad" : undefined, textDecoration: gone ? "line-through" : "none", background: !gone && i < 3 && p > 0.6 ? "#fff3c4" : "transparent", display: "table", padding: "0 6px", marginLeft: -6 }}>• {t}</div>
            );
          })}
          <div style={{ fontSize: 25, fontWeight: 650, marginTop: 12 }}>Why these three</div>
          <div>They answer four in five of the searches that find nothing today.</div>
        </div>
      </div>
    </Browser>
  );
}

export function Relay({ p }: { p: number }) {
  const all: [string, string, string][] = [
    ["Priya", "#e11d48", "Morning. Roadmap draft is up, please be brutal."], ["Jonas", "#0ea5e9", "Six things is four too many for a quarter."], ["Mira", "#8b5cf6", "Federated search can wait. Nobody asked twice."],
    ["Priya", "#e11d48", "Agreed, cutting it. Synonyms stay?"], ["Jules", "#15803d", "Synonyms are most of the misses. They stay."], ["Jonas", "#0ea5e9", "Then filters by the 20th, typos by the 4th."], ["Mira", "#8b5cf6", "Works for me. Demo on the 8th."], ["Priya", "#e11d48", "Done. Thank you all, that was quick."],
  ];
  return (
    <Browser place="relay" light>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 220, background: "#2b1d3a", color: "#e9e2f1", padding: "22px 20px", fontSize: 17, lineHeight: 2.1 }}>
        <div style={{ fontSize: 21, fontWeight: 700, marginBottom: 8 }}>Acme</div>
        {["general", "roadmap", "tokenizer", "design", "random"].map((c) => (
          <div key={c} style={{ margin: "0 -10px", padding: "0 10px", borderRadius: 8, background: c === "roadmap" ? "#6d4aff" : "transparent" }}># {c}</div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 220, right: 0, top: 0, bottom: 0, color: "#1d1c1d" }}>
        <div style={{ padding: "15px 30px", borderBottom: "1px solid #e5e5e5", fontSize: 20, fontWeight: 700 }}># roadmap</div>
        <div style={{ padding: "18px 30px", display: "flex", flexDirection: "column", gap: 17, fontSize: 18.5 }}>
          {all.slice(0, 3 + Math.round(p * 5)).slice(-6).map(([who, color, text], i) => (
            <div key={i} style={{ display: "flex", gap: 15 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: color, color: "#fff", fontWeight: 700, fontSize: 20, display: "grid", placeItems: "center", flex: "none" }}>{who[0]}</div>
              <div><b>{who}</b><div>{text}</div></div>
            </div>
          ))}
        </div>
      </div>
    </Browser>
  );
}
