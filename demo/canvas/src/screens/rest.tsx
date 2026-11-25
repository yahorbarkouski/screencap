import React from "react";
import { Lights } from "../../../resume/src/apps";
import { Browser, hex, ink, mix, part, rand, serif, ui } from "./kit";

/* ---------- the poster, drawn over the day ---------- */

export function Poster({ p, w = 360 }: { p: number; w?: number }) {
  const on = (a: number, b: number) => part(p, a, b);
  const sky = p < 0.8 ? "#1b1f4a" : hex("#1b1f4a", "#3a1447", on(0.8, 1));
  return (
    <svg width={w} height={w * 1.36} viewBox="0 0 360 490" style={{ display: "block" }}>
      <defs>
        <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky} />
          <stop offset="1" stopColor={p < 0.15 ? "#2a2f66" : hex("#e2574c", "#ff8a4a", on(0.7, 1))} />
        </linearGradient>
      </defs>
      <rect width={360} height={490} fill={p < 0.06 ? "#f7f4ec" : "url(#night)"} />
      <circle cx={262} cy={112} r={58 * on(0.06, 0.16)} fill="#ffe9b0" />
      <circle cx={286} cy={98} r={50 * on(0.1, 0.18)} fill={sky} opacity={p < 0.72 ? 1 : 0} />
      {Array.from({ length: 40 }, (_, i) => (
        <circle key={i} cx={rand(i) * 360} cy={rand(i + 30) * 220} r={1 + rand(i + 4) * 1.4} fill="#fff" opacity={on(0.14, 0.3) * 0.8} />
      ))}
      {Array.from({ length: 13 }, (_, i) => {
        const h = (50 + rand(i + 12) * 110) * on(0.22 + i * 0.012, 0.34 + i * 0.012);
        return <rect key={i} x={i * 29 - 8} y={400 - h} width={30} height={h + 100} fill={hex("#141634", "#2b0f2f", on(0.8, 1))} />;
      })}
      {Array.from({ length: 70 }, (_, i) => (
        <rect key={`w${i}`} x={rand(i + 2) * 350} y={300 + rand(i + 44) * 120} width={4} height={6} fill="#ffd27a" opacity={on(0.36, 0.46) * (rand(i) > 0.35 ? 0.9 : 0)} />
      ))}
      <path d="M0 236 Q90 292 180 250 T360 236" stroke="#f4d9a0" strokeWidth={2} fill="none" opacity={on(0.42, 0.48)} />
      {[34, 92, 150, 208, 266, 324].map((x, i) => {
        const a = on(0.44 + i * 0.025, 0.5 + i * 0.025);
        const y = 258 + Math.sin(i * 1.15) * 12;
        return (
          <g key={x} opacity={a} transform={`translate(${x} ${y})`}>
            <ellipse cx={0} cy={18} rx={34} ry={34} fill="#ff9a4a" opacity={0.25} />
            <rect x={-13} y={0} width={26} height={36} rx={13} fill={i % 2 ? "#ff6b4a" : "#ffc24a"} />
            <path d="M-13 12 h26 M-13 24 h26" stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />
          </g>
        );
      })}
      <text x={28} y={366} fontSize={60} fontWeight={800} fill="#fff6e0" fontFamily={serif} letterSpacing={-2} opacity={on(0.6, 0.68)}>Night</text>
      <text x={28} y={420} fontSize={60} fontWeight={800} fill="#fff6e0" fontFamily={serif} letterSpacing={-2} opacity={on(0.64, 0.72)}>Market</text>
      <text x={30} y={456} fontSize={18} fontWeight={600} fill="#fff6e0" fontFamily={ui} opacity={on(0.74, 0.8)}>Saturday 28 November</text>
      <text x={330} y={456} textAnchor="end" fontSize={18} fontWeight={600} fill="#fff6e0" fontFamily={ui} opacity={on(0.78, 0.84)}>18 to 23</text>
    </svg>
  );
}

export function Easel({ p }: { p: number }) {
  const layers = ["Date", "Title", "Lanterns", "Wire", "Windows", "Skyline", "Stars", "Moon", "Sky"];
  return (
    <Browser place="easel" light>
      <div style={{ position: "absolute", inset: 0, background: "#e6e6ea" }} />
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 186, background: "#fff", borderRight: "1px solid #dcdce0", padding: "18px 18px", boxSizing: "border-box", color: "#1d1d1f", fontSize: 16, lineHeight: 2.2 }}>
        <b>Layers</b>
        {layers.slice(Math.max(0, layers.length - 1 - Math.round(p * 8))).map((l, i) => (
          <div key={l} style={{ margin: "0 -10px", padding: "0 10px", borderRadius: 7, background: i === 0 ? "#e3ecff" : "transparent" }}>{l}</div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 186, right: 190, top: 0, bottom: 0, display: "grid", placeItems: "center" }}>
        <div style={{ boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}>
          <Poster p={p} w={372} />
        </div>
      </div>
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 190, background: "#fff", borderLeft: "1px solid #dcdce0", padding: "18px 18px", boxSizing: "border-box", color: "#1d1d1f", fontSize: 16 }}>
        <b>Colour</b>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 9, margin: "14px 0 24px" }}>
          {["#1b1f4a", "#ffe9b0", "#ff6b4a", "#ffc24a", "#e2574c", "#3a1447", "#fff6e0", "#141634"].map((c) => (
            <div key={c} style={{ height: 34, borderRadius: 8, background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)" }} />
          ))}
        </div>
        <b>Type</b>
        <div style={{ fontFamily: serif, fontSize: 32, fontWeight: 800, margin: "10px 0" }}>Night</div>
        <div style={{ color: "#6e6e73" }}>New York, Heavy</div>
      </div>
    </Browser>
  );
}

export function Board({ p }: { p: number }) {
  const tiles = Array.from({ length: 12 }, (_, i) => i);
  return (
    <Browser place="board" light>
      <div style={{ columns: 4, columnGap: 16, padding: "22px 26px", transform: `translateY(${-p * 130}px)` }}>
        {tiles.map((i) => {
          const h = 120 + Math.round(rand(i + 3) * 150);
          const [a, b] = [["#1b1f4a", "#ff8a4a"], ["#4a1d2e", "#ffc24a"], ["#133b3a", "#e8d08a"], ["#2d1b4a", "#ff6b8a"]][i % 4];
          return (
            <svg key={i} width="100%" height={h} viewBox={`0 0 220 ${h}`} preserveAspectRatio="xMidYMid slice" style={{ borderRadius: 14, marginBottom: 16, display: "block", breakInside: "avoid", background: a }}>
              {[0, 1, 2, 3].map((k) => (
                <g key={k} transform={`translate(${30 + k * 54} ${h * (0.3 + 0.3 * rand(i * 7 + k))})`}>
                  <circle r={44} fill={b} opacity={0.22} />
                  {i % 3 === 0 ? <circle r={20} fill={b} /> : <rect x={-15} y={-22} width={30} height={44} rx={15} fill={b} />}
                </g>
              ))}
            </svg>
          );
        })}
      </div>
    </Browser>
  );
}

/* ---------- chess ---------- */

const start = ["rnbqkbnr", "pppppppp", "........", "........", "........", "........", "PPPPPPPP", "RNBQKBNR"];
const moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3", "g8f6", "d2d4", "e5d4", "c3d4", "c5b4", "b1c3", "f6e4", "e1g1", "b4c3", "d4d5", "c3f6", "f1e1", "c6e7", "e1e4", "d7d6", "d1a4", "c8d7"];
function boardAt(n: number) {
  const b = start.map((r) => r.split(""));
  const at = (s: string) => [8 - Number(s[1]), s.charCodeAt(0) - 97];
  for (const m of moves.slice(0, n)) {
    const [r0, c0] = at(m.slice(0, 2)), [r1, c1] = at(m.slice(2));
    b[r1][c1] = b[r0][c0];
    b[r0][c0] = ".";
    if (m === "e1g1") { b[7][5] = "R"; b[7][7] = "."; }
  }
  return b;
}
const glyph: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

export function Chess({ p }: { p: number }) {
  const n = Math.round(p * moves.length);
  const board = boardAt(n);
  const last = moves[n - 1];
  const lit = (r: number, c: number) => last && [last.slice(0, 2), last.slice(2)].some((s) => 8 - Number(s[1]) === r && s.charCodeAt(0) - 97 === c);
  return (
    <Browser place="chess">
      <div style={{ position: "absolute", inset: 0, background: "#2a2723" }}>
        <div style={{ position: "absolute", left: 66, top: 22, width: 504, height: 504, borderRadius: 8, overflow: "hidden", display: "grid", gridTemplateColumns: "repeat(8, 63px)" }}>
          {board.flatMap((row, r) =>
            row.map((c, f) => (
              <div key={`${r}${f}`} style={{ width: 63, height: 63, background: lit(r, f) ? ((r + f) % 2 ? "#b6b04a" : "#e6dd77") : (r + f) % 2 ? "#7d9a5e" : "#ebecd3", display: "grid", placeItems: "center", fontSize: 50, lineHeight: 1, color: c === c.toUpperCase() ? "#fbfbf7" : "#2a2a28", textShadow: c === c.toUpperCase() ? "0 0 2px #333, 0 1px 2px rgba(0,0,0,0.5)" : "none", fontFamily: '"Apple Symbols", "Arial Unicode MS", sans-serif' }}>
                {c === "." ? "" : glyph[c.toLowerCase()]}
              </div>
            )),
          )}
        </div>
        <div style={{ position: "absolute", left: 606, right: 36, top: 22, bottom: 22, color: ink.text, fontSize: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 18px", background: "#36322d", borderRadius: 10 }}><b>Nora</b><span>{`${9 - Math.floor(p * 6)}:${String(48 - Math.round(p * 40)).padStart(2, "0")}`}</span></div>
          <div style={{ height: 372, margin: "14px 0", background: "#211f1b", borderRadius: 10, padding: "14px 18px", boxSizing: "border-box", fontSize: 18.5, lineHeight: 1.72, overflow: "hidden", display: "grid", gridTemplateColumns: "40px 1fr 1fr", alignContent: "start", color: "#cfcabf" }}>
            {Array.from({ length: Math.ceil(n / 2) }, (_, i) => (
              <React.Fragment key={i}><span style={{ opacity: 0.5 }}>{i + 1}</span><span>{moves[i * 2].slice(2)}</span><span>{i * 2 + 1 < n ? moves[i * 2 + 1].slice(2) : ""}</span></React.Fragment>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 18px", background: "#36322d", borderRadius: 10 }}><b>You</b><span>{`${9 - Math.floor(p * 5)}:${String(30 - Math.round(p * 22)).padStart(2, "0")}`}</span></div>
        </div>
      </div>
    </Browser>
  );
}

/* ---------- the rest of a day ---------- */

export function Flat({ p }: { p: number }) {
  return (
    <Browser place="flat" light>
      <div style={{ color: "#1d1d1f" }}>
        <svg width={984} height={300} style={{ display: "block" }}>
          <rect width={984} height={300} fill={hex("#bfe0ee", "#f3c9a6", p)} />
          {Array.from({ length: 9 }, (_, i) => {
            const h = 150 + rand(i + 2) * 70;
            const c = ["#b65c48", "#d6a35c", "#7d8f83", "#c98a7a", "#8a6f5a"][i % 5];
            return (
              <g key={i} transform={`translate(${i * 112 - 14 - p * 40} ${230 - h})`}>
                <path d={`M0 0 L56 -34 L112 0 Z`} fill="#4a4340" />
                <rect width={112} height={h} fill={c} />
                {[0, 1, 2].map((r) => [0, 1].map((q) => <rect key={`${r}${q}`} x={20 + q * 44} y={18 + r * 52} width={28} height={38} fill="#fdf3d8" stroke="#fff" strokeWidth={4} />))}
              </g>
            );
          })}
          <rect y={226} width={984} height={80} fill="#5c93a8" />
          {Array.from({ length: 22 }, (_, i) => <rect key={i} x={rand(i) * 984} y={236 + rand(i + 5) * 56} width={50} height={3} fill="#fff" opacity={0.35} />)}
        </svg>
        <div style={{ padding: "22px 44px", display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 650 }}>Two rooms by the canal</div>
            <div style={{ fontSize: 18.5, color: "#6e6e73", margin: "6px 0 18px" }}>58 m², third floor, from January</div>
            <div style={{ display: "flex", gap: 12 }}>{["Balcony", "Bath", "Quiet street", "Cat friendly"].slice(0, 2 + Math.round(p * 2)).map((t) => <span key={t} style={{ background: "#eef1f4", borderRadius: 20, padding: "8px 18px", fontSize: 17 }}>{t}</span>)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 650 }}>€1,380</div>
            <div style={{ background: "#0e7490", color: "#fff", borderRadius: 12, padding: "12px 24px", fontSize: 18, fontWeight: 600, marginTop: 14 }}>{p > 0.6 ? "Viewing on Friday" : "Ask for a viewing"}</div>
          </div>
        </div>
      </div>
    </Browser>
  );
}

export function Run({ p }: { p: number }) {
  const km = [5, 0, 8, 0, 6, 0, 14, 6, 0, 10, 0, 7, 0, 16];
  const done = 8 + Math.round(p * 5);
  return (
    <Browser place="run">
      <div style={{ position: "absolute", inset: 0, background: "#15161a", padding: "30px 48px", color: ink.text }}>
        <div style={{ fontSize: 32, fontWeight: 650 }}>Half marathon plan</div>
        <div style={{ fontSize: 18, color: ink.secondary, marginTop: 4 }}>Week {p < 0.5 ? 6 : 7} of 12</div>
        <svg width={888} height={380} style={{ marginTop: 18 }}>
          {km.map((k, i) => (
            <g key={i} transform={`translate(${i * 63.5} 0)`}>
              <rect x={6} y={320 - k * 18} width={46} height={Math.max(4, k * 18)} rx={8} fill={i < done ? "#34d399" : "#2d3038"} />
              <text x={29} y={352} textAnchor="middle" fontSize={17} fill="#8b8f99" fontFamily={ui}>{"MTWTFSS"[i % 7]}</text>
              {k > 0 && <text x={29} y={310 - k * 18} textAnchor="middle" fontSize={18} fill={i < done ? "#d1fae5" : "#8b8f99"} fontFamily={ui} fontWeight={600}>{k}</text>}
            </g>
          ))}
        </svg>
      </div>
    </Browser>
  );
}

export function Bread({ p }: { p: number }) {
  const steps = ["Feed the starter and wait until it doubles", "Mix flour and water, rest for an hour", "Add salt, fold four times", "Shape, and into the fridge overnight", "Bake hot in a closed pot, then open"];
  const at = Math.round(p * 3);
  return (
    <Browser place="bread" light>
      <div style={{ position: "absolute", inset: 0, background: "#fbf6ee", display: "flex", color: "#3a2c20", fontFamily: serif }}>
        <svg width={400} height={549}>
          <rect width={400} height={549} fill="#e8d5b5" />
          <ellipse cx={200} cy={330} rx={150} ry={mix(86, 112, p)} fill="#b87a3c" />
          <ellipse cx={200} cy={314} rx={142} ry={mix(78, 102, p)} fill="#d49a55" />
          {[-80, -30, 20, 70].map((x) => <path key={x} d={`M${200 + x} ${270 - p * 10} q24 46 8 104`} stroke="#f6e6c8" strokeWidth={10} fill="none" strokeLinecap="round" />)}
        </svg>
        <div style={{ flex: 1, padding: "46px 48px" }}>
          <div style={{ fontSize: 38, fontWeight: 700, marginBottom: 22 }}>Overnight sourdough</div>
          {steps.map((s, i) => (
            <div key={s} style={{ display: "flex", gap: 18, fontSize: 21, padding: "10px 0", opacity: i <= at ? 1 : 0.4 }}><b style={{ width: 22 }}>{i + 1}</b>{s}</div>
          ))}
        </div>
      </div>
    </Browser>
  );
}

export function Invoices({ p }: { p: number }) {
  const rows: [string, string, string][] = [["Acme, October", "€6,400", "Paid"], ["Night Market, poster", "€900", "Sent"], ["Harbour Café, menu", "€450", "Paid"], ["Nora's book cover", "€1,200", "Draft"], ["Canal festival", "€780", "Sent"]];
  return (
    <Browser place="invoices" light>
      <div style={{ padding: "32px 50px", color: "#1d1d1f" }}>
        <div style={{ fontSize: 34, fontWeight: 650, marginBottom: 20 }}>Invoices</div>
        {rows.map(([who, sum, state], i) => {
          const s = p > 0.5 && state === "Draft" ? "Sent" : state;
          return (
            <div key={who} style={{ display: "flex", alignItems: "center", fontSize: 21, padding: "17px 0", borderTop: "1px solid #e8e8ec" }}>
              <span style={{ flex: 1 }}>{who}</span>
              <span style={{ width: 140, textAlign: "right" }}>{sum}</span>
              <span style={{ width: 150, textAlign: "right" }}><span style={{ borderRadius: 14, padding: "5px 16px", fontSize: 17, background: s === "Paid" ? "#dcfce7" : s === "Sent" ? "#dbeafe" : "#eee", color: s === "Paid" ? "#15803d" : s === "Sent" ? "#2563eb" : "#666" }}>{s}</span></span>
            </div>
          );
        })}
      </div>
    </Browser>
  );
}

export function Weather({ p }: { p: number }) {
  return (
    <Browser place="weather" light>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${hex("#3b82c4", "#4f6f9c", p)}, ${hex("#a8d4ee", "#c9b7c9", p)})`, color: "#fff", textAlign: "center", paddingTop: 50 }}>
        <div style={{ fontSize: 26, fontWeight: 500 }}>Saturday</div>
        <div style={{ fontSize: 118, fontWeight: 250, lineHeight: 1.15 }}>{p > 0.5 ? 11 : 14}°</div>
        <div style={{ fontSize: 23 }}>Clear in the evening</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 46 }}>
          {["Thu", "Fri", "Sat", "Sun", "Mon", "Tue"].map((d, i) => (
            <div key={d} style={{ width: 108, borderRadius: 18, background: "rgba(255,255,255,0.18)", padding: "18px 0", fontSize: 20 }}>
              {d}
              <div style={{ width: 38, height: 38, borderRadius: 19, margin: "14px auto", background: i % 3 === 1 ? "#e6edf4" : "#ffd76a" }} />
              {10 + i}°
            </div>
          ))}
        </div>
      </div>
    </Browser>
  );
}

export function Calendar({ p }: { p: number }) {
  const events: [number, number, number, string, string][] = [[0, 1, 2, "Standup", "#2563eb"], [0, 4, 1.5, "Roadmap", "#7c3aed"], [1, 2, 3, "Poster", "#e11d48"], [2, 1, 1.5, "Nora", "#15803d"], [2, 4.5, 2, "Launch day", "#b45309"], [3, 2, 2, "Viewing", "#0e7490"], [4, 3, 3, "Night Market", "#c2410c"]];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1e1e1e", color: ink.text, fontFamily: ui }}>
      <Lights active x={15} y={15} />
      <div style={{ position: "absolute", left: 30, top: 50, fontSize: 32, fontWeight: 700 }}>November</div>
      {["Tue 10", "Wed 11", "Thu 12", "Fri 13", "Sat 14"].map((d, i) => (
        <div key={d} style={{ position: "absolute", left: 60 + i * 182, top: 112, width: 176, bottom: 20, borderLeft: `1px solid ${ink.hairline}`, paddingLeft: 10, fontSize: 17, color: i === 2 ? "#ff6961" : ink.secondary }}>{d}</div>
      ))}
      {events.slice(0, 5 + Math.round(p * 2)).map(([c, y, h, name, color]) => (
        <div key={name} style={{ position: "absolute", left: 68 + c * 182, top: 150 + y * 56, width: 164, height: h * 56 - 6, borderRadius: 9, background: color, padding: "8px 12px", boxSizing: "border-box", fontSize: 17, fontWeight: 600, color: "#fff" }}>{name}</div>
      ))}
    </div>
  );
}

export function Music({ p }: { p: number }) {
  const [a, b, name] = [["#123b5a", "#f2b35a", "Harbour Lights"], ["#4a1d4e", "#ff8aa0", "Slow Trains"], ["#17382c", "#d7e58a", "Moss"]][Math.min(2, Math.floor(p * 3))];
  return (
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(120deg, ${a}, #101114 85%)`, color: "#fff", fontFamily: ui }}>
      <Lights active x={15} y={15} />
      <svg width={400} height={400} viewBox="0 0 400 400" style={{ position: "absolute", left: 80, top: 100, borderRadius: 16, boxShadow: "0 24px 70px rgba(0,0,0,0.5)" }}>
        <rect width={400} height={400} fill={a} />
        {[170, 130, 90, 50].map((r, i) => <circle key={r} cx={200 + i * 14} cy={210 - i * 8} r={r} fill={b} opacity={0.22 + i * 0.2} />)}
        <path d="M0 320 Q100 280 200 320 T400 310 V400 H0 Z" fill={b} opacity={0.85} />
      </svg>
      <div style={{ position: "absolute", left: 540, top: 208 }}>
        <div style={{ fontSize: 44, fontWeight: 700 }}>{name}</div>
        <div style={{ fontSize: 23, opacity: 0.7, marginTop: 6 }}>The Paper Boats</div>
        <div style={{ width: 360, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.25)", marginTop: 44 }}><div style={{ width: `${30 + p * 50}%`, height: 6, borderRadius: 3, background: "#fff" }} /></div>
      </div>
    </div>
  );
}
