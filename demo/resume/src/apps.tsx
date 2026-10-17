import React from "react";
import { ink, mono, ui } from "./theme";

// The four apps of the made-up afternoon, at their size on the demo's 1024-point screen. Everything in them is
// invented: the people, the repository, the sessions, the pages. Each shows real words rather than placeholder
// bars, and only as much as tells one place from another.

export function Lights({ active, x = 14, y = 14 }: { active: boolean; x?: number; y?: number }) {
  const colors = active ? ["#ff5f57", "#febc2e", "#28c840"] : ["#4b4b50", "#4b4b50", "#4b4b50"];
  return (
    <div style={{ position: "absolute", left: x, top: y, display: "flex", gap: 8 }}>
      {colors.map((c, i) => (
        <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
      ))}
    </div>
  );
}

/** A thin ring in a thread's colour, for the part of a window that belongs to it. */
export type Glow = { color: string; strength: number };
const ring = (glow?: Glow) => (glow && glow.strength > 0 ? `0 0 0 2px ${withAlpha(glow.color, glow.strength)}` : "none");

/** `#2563EB` at an opacity, for a ring that fades in and out. */
export const withAlpha = (hex: string, alpha: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`;

/* ---------- Dia ---------- */

export type Tab = { id: string; title: string; url: string; letter: string; color: string; dark?: boolean };

export const tabs: Tab[] = [
  { id: "gion", title: "Gion — Wikipedia", url: "en.wikipedia.org/wiki/Gion", letter: "W", color: "#e4e4e7", dark: true },
  { id: "mail", title: "Inbox (3)", url: "mail.acme.dev/inbox", letter: "M", color: "#2563eb" },
  { id: "docs", title: "Q4 roadmap", url: "docs.google.com/document/d/q4-roadmap", letter: "D", color: "#1a73e8" },
  { id: "pr", title: "Fix nested quotes #482", url: "github.com/acme/tokenizer/pull/482", letter: "G", color: "#6e7681" },
  { id: "hn", title: "Hacker News", url: "news.ycombinator.com", letter: "Y", color: "#ff6600" },
];
export const tabIndex = (id: string) => tabs.findIndex((t) => t.id === id);

/** Where the tab strip puts each tab: the chosen one wide enough for its title, the rest just their icons. */
export function tabRect(index: number, chosen: number) {
  let x = 76;
  for (let i = 0; i < index; i++) x += (i === chosen ? 176 : 30) + 4;
  return { x, y: 8, width: index === chosen ? 176 : 30, height: 26 };
}

function Favicon({ tab, size = 15 }: { tab: Tab; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: tab.color,
        color: tab.dark ? "#111" : "white",
        fontSize: size * 0.64,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      {tab.letter}
    </div>
  );
}

export function Browser({ tab, active, glow }: { tab: number; active: boolean; glow?: Glow }) {
  const current = tabs[tab];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#202024", color: ink.text, fontFamily: ui }}>
      <Lights active={active} />
      {tabs.map((t, i) => {
        const r = tabRect(i, tab);
        const chosen = i === tab;
        return (
          <div
            key={t.id}
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
              borderRadius: 7,
              background: chosen ? "rgba(255,255,255,0.13)" : "transparent",
              boxShadow: chosen ? ring(glow) : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: chosen ? "flex-start" : "center",
              gap: 7,
              padding: chosen ? "0 9px" : 0,
              boxSizing: "border-box",
              fontSize: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <Favicon tab={t} />
            {chosen && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 40,
          height: 26,
          borderRadius: 8,
          background: "rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          padding: "0 11px",
          fontSize: 12,
          color: ink.secondary,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {current.url}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 74, bottom: 0, overflow: "hidden" }}>
        <Page id={current.id} />
      </div>
    </div>
  );
}

function Page({ id }: { id: string }) {
  if (id === "pr") return <PullRequest />;
  if (id === "gion") return <Gion />;
  if (id === "mail") return <Inbox />;
  if (id === "docs") return <Roadmap />;
  return <div style={{ position: "absolute", inset: 0, background: "#16161a" }} />;
}

function PullRequest() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0d1117", padding: "14px 20px", fontSize: 12.5 }}>
      <div style={{ color: ink.secondary, marginBottom: 8 }}>
        acme / <b style={{ color: ink.text }}>tokenizer</b>
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 8 }}>
        Fix nested quotes in tokenizer <span style={{ color: ink.tertiary, fontWeight: 400 }}>#482</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, color: ink.secondary }}>
        <span style={{ background: "#238636", color: "white", borderRadius: 12, padding: "3px 10px", fontWeight: 600 }}>Open</span>
        jules wants to merge 3 commits
      </div>
      <div style={{ border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ background: "#161b22", padding: "7px 11px", color: ink.secondary }}>
          <b style={{ color: ink.text }}>mira</b> requested changes
        </div>
        <div style={{ padding: "9px 11px", lineHeight: 1.5 }}>
          The fix looks right. Can you add a test for a quote inside a quote first?
          <div style={{ fontFamily: mono, background: "#161b22", borderRadius: 6, padding: "5px 9px", marginTop: 7, fontSize: 12 }}>
            "say \"hi\" twice"
          </div>
        </div>
      </div>
      <div style={{ border: "1px solid #30363d", borderRadius: 8, padding: "8px 11px", display: "flex", gap: 9 }}>
        <span style={{ color: "#f85149", fontWeight: 700 }}>✕</span>
        <span>
          <b>cargo test</b> <span style={{ color: ink.secondary }}>· 1 failing check</span>
        </span>
      </div>
    </div>
  );
}

function Gion() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#101418", padding: "14px 20px", fontSize: 12.5, lineHeight: 1.55 }}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 26 }}>Gion</div>
      <div style={{ color: ink.tertiary, fontSize: 11, borderBottom: "1px solid #2a2f36", paddingBottom: 7, marginBottom: 10 }}>
        From Wikipedia, the free encyclopedia
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, color: ink.secondary }}>
          <p style={{ margin: "0 0 8px" }}>
            <b style={{ color: ink.text }}>Gion</b> is a district of Kyoto, east of the Kamo River, known for its wooden
            machiya houses and its teahouses.
          </p>
          <p style={{ margin: 0 }}>Hanami-kōji, its best-known street, runs south from Shijō-dōri.</p>
        </div>
        <div style={{ width: 130, height: 160, borderRadius: 6, flex: "none", position: "relative", overflow: "hidden", background: "linear-gradient(180deg, #1b2a4a 0%, #2c2340 55%, #4a2a22 100%)" }}>
          {[22, 52, 82, 108].map((x, i) => (
            <div key={i} style={{ position: "absolute", left: x, top: 58 + i * 10, width: 11, height: 16, borderRadius: 6, background: "#ffb347", boxShadow: "0 0 14px #ff9a3c" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Inbox() {
  const rows = [
    ["Mira", "Re: nested quotes, one more test please"],
    ["Calendar", "Standup moved to 15:00"],
    ["Ryokan Sakura", "Your booking request for 9 April"],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#16161a", padding: "10px 0", fontSize: 12.5 }}>
      {rows.map(([from, subject]) => (
        <div key={from} style={{ display: "flex", gap: 12, padding: "9px 20px", borderBottom: `1px solid ${ink.hairline}` }}>
          <b style={{ width: 96, flex: "none" }}>{from}</b>
          <span style={{ color: ink.secondary }}>{subject}</span>
        </div>
      ))}
    </div>
  );
}

function Roadmap() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1b1c1f", display: "flex", justifyContent: "center", paddingTop: 12 }}>
      <div style={{ width: 380, background: "#f8f9fa", color: "#1f2328", borderRadius: 3, padding: "20px 28px", fontSize: 12.5, lineHeight: 1.65 }}>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Q4 roadmap</div>
        <div style={{ fontWeight: 600 }}>Search</div>
        <div>• Typo tolerance</div>
        <div>• Synonyms</div>
        <div>• Faceted filters</div>
        <div style={{ textDecoration: "line-through", color: "#8b949e" }}>• Federated search</div>
      </div>
    </div>
  );
}

/* ---------- Claude ---------- */

export const sessions = [
  { id: "trips", title: "Plan Kyoto day trips", folder: "notes" },
  { id: "agenda", title: "Draft offsite agenda", folder: "notes" },
  { id: "call", title: "Summarize call notes", folder: "notes" },
  { id: "flags", title: "Rename CLI flags", folder: "cli" },
  { id: "borrow", title: "Explain a borrow error", folder: "tokenizer" },
  { id: "release", title: "Write release notes 0.9", folder: "tokenizer" },
  { id: "takehome", title: "Review take-home", folder: "hiring" },
  { id: "bench", title: "Benchmark the lexer", folder: "tokenizer" },
  { id: "toml", title: "Port config to TOML", folder: "cli" },
  { id: "issue", title: "Answer issue #477", folder: "tokenizer" },
  { id: "deps", title: "Bump dependencies", folder: "cli" },
  { id: "ci", title: "Flaky CI on macOS", folder: "tokenizer" },
  { id: "tokenizer", title: "Fix tokenizer for nested quotes", folder: "tokenizer" },
  { id: "plugins", title: "Sketch the plugin API", folder: "cli" },
];
export const sidebarTop = 104;
export const sessionRow = (index: number, scroll: number) => ({ y: sidebarTop + 4 + index * 40 - scroll, height: 36 });

export function Claude(props: { session: string; scroll: number; active: boolean; glow?: Glow }) {
  const { session, scroll, active, glow } = props;
  const chosen = sessions.find((s) => s.id === session)!;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#262624", color: ink.text, fontSize: 13, fontFamily: ui }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 196, background: "#1f1e1d", overflow: "hidden" }}>
        <Lights active={active} />
        <div style={{ position: "absolute", left: 10, right: 10, top: 42, height: 28, borderRadius: 7, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 10px", color: ink.secondary }}>
          + New session
        </div>
        <div style={{ position: "absolute", left: 20, top: 84, fontSize: 10.5, color: ink.tertiary, fontWeight: 600, letterSpacing: 0.4 }}>CODE</div>
        <div style={{ position: "absolute", left: 0, right: 0, top: sidebarTop, bottom: 0, overflow: "hidden", maskImage: "linear-gradient(180deg, transparent 0, black 10px)" }}>
          {sessions.map((s, i) => {
            const row = sessionRow(i, scroll);
            const chosen = s.id === session;
            return (
              <div
                key={s.id}
                style={{
                  position: "absolute",
                  left: 8,
                  right: 8,
                  top: row.y - sidebarTop,
                  height: row.height,
                  borderRadius: 7,
                  background: chosen ? "rgba(255,255,255,0.10)" : "transparent",
                  boxShadow: chosen ? ring(glow) : "none",
                  padding: "3px 10px",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 12.5 }}>{s.title}</div>
                <div style={{ fontSize: 10.5, color: ink.tertiary }}>{s.folder}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: "absolute", left: 196, right: 0, top: 0, bottom: 0, overflow: "hidden" }}>
        <div style={{ height: 42, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: `1px solid ${ink.hairline}` }}>
          <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chosen.title}</span>
        </div>
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, lineHeight: 1.45 }}>
          <Conversation id={session} />
        </div>
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, height: 36, borderRadius: 11, background: "#30302e", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", padding: "0 12px", color: ink.tertiary }}>
          Reply to Claude…
        </div>
      </div>
    </div>
  );
}

function You({ children }: { children: React.ReactNode }) {
  return <div style={{ alignSelf: "flex-end", maxWidth: "88%", background: "#3a3a37", borderRadius: 11, padding: "7px 11px" }}>{children}</div>;
}

function Tool({ name, target, children }: { name: string; target: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8, overflow: "hidden", fontSize: 11.5 }}>
      <div style={{ padding: "5px 10px", background: "rgba(255,255,255,0.04)", color: ink.secondary }}>
        <b style={{ color: ink.text }}>{name}</b> <span style={{ fontFamily: mono }}>{target}</span>
      </div>
      {children}
    </div>
  );
}

function Conversation({ id }: { id: string }) {
  if (id === "tokenizer") {
    const added = ["#[test]", "fn nested_quotes() {", '  let s = r#""say \\"hi\\" twice""#;', "  assert_eq!(tokenize(s).len(), 1);", "}"];
    return (
      <>
        <You>mira asked for a failing test before the fix. Add it to tests/tokenize.rs and run it.</You>
        <div>I'll add the test first, so we can watch it fail.</div>
        <Tool name="Edit" target="tests/tokenize.rs">
          <div style={{ fontFamily: mono, fontSize: 11, padding: "5px 0" }}>
            {added.map((line, i) => (
              <div key={i} style={{ background: "rgba(46,160,67,0.16)", padding: "0 10px", whiteSpace: "pre", color: "#aff5b4" }}>
                + {line}
              </div>
            ))}
          </div>
        </Tool>
        <Tool name="Run" target="cargo test nested">
          <div style={{ padding: "5px 10px", color: "#ff9492", fontFamily: mono }}>1 failed: nested_quotes</div>
        </Tool>
        <div>It fails as mira described: the string ends at the first escaped quote.</div>
      </>
    );
  }
  return (
    <>
      <You>Plan three day trips from Kyoto for April.</You>
      <div>Three that each fit in a day:</div>
      <div style={{ color: ink.secondary }}>
        <b style={{ color: ink.text }}>Nara</b> · the deer park and Tōdai-ji, 45 minutes by train
        <br />
        <b style={{ color: ink.text }}>Arashiyama</b> · the bamboo grove, best before 8 am
        <br />
        <b style={{ color: ink.text }}>Uji</b> · tea houses along the river, and Byōdō-in
      </div>
    </>
  );
}

/* ---------- Ghostty ---------- */

export function Terminal({ active }: { active: boolean }) {
  const lines: [string, string?][] = [
    ["~/code/tokenizer ❯ cargo test nested", "#7ee787"],
    ["running 3 tests"],
    ["test splits_on_spaces ... ok", "#7ee787"],
    ["test keeps_single_quotes ... ok", "#7ee787"],
    ["test nested_quotes ... FAILED", "#ff7b72"],
    ['  left: ["say \\"hi", "twice\\""]'],
    [' right: ["say \\"hi\\" twice"]'],
    ["test result: FAILED. 2 passed; 1 failed", "#ff7b72"],
    ["~/code/tokenizer ❯ █", "#7ee787"],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#18191d", color: "#d6d9de", fontFamily: ui }}>
      <Lights active={active} y={9} />
      <div style={{ textAlign: "center", fontSize: 12, color: ink.secondary, paddingTop: 7 }}>tokenizer — cargo test</div>
      <div style={{ fontFamily: mono, fontSize: 11.5, lineHeight: 1.5, padding: "6px 14px" }}>
        {lines.map(([text, color], i) => (
          <div key={i} style={{ color, whiteSpace: "pre" }}>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Notes ---------- */

export function Notes({ active }: { active: boolean }) {
  const items: [boolean, string][] = [
    [true, "Flights to Osaka, 9 April"],
    [false, "Ryokan: Sakura or Hanami?"],
    [false, "Fushimi Inari before 7 am"],
    [false, "Lunch at Nishiki market"],
    [false, "Day trip to Nara"],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1e1e1e", color: ink.text, fontFamily: ui }}>
      <Lights active={active} />
      <div style={{ padding: "40px 22px 0" }}>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Kyoto in April</div>
        {items.map(([done, text]) => (
          <div key={text} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, padding: "5px 0" }}>
            <div
              style={{
                width: 15,
                height: 15,
                borderRadius: 8,
                border: done ? "none" : "1.5px solid rgba(255,255,255,0.4)",
                background: done ? "#e5b931" : "transparent",
                fontSize: 10,
                color: "#1e1e1e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {done ? "✓" : ""}
            </div>
            <span style={{ color: done ? ink.tertiary : ink.text, textDecoration: done ? "line-through" : "none" }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
