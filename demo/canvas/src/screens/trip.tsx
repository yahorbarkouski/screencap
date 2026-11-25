import React from "react";
import { Lights } from "../../../resume/src/apps";
import { Browser, clamp, hex, ink, mix, part, rand, serif, ui } from "./kit";

const stops = ["Yasaka shrine", "Gion, Hanamikoji", "Kennin-ji", "Kiyomizu-dera", "Fushimi Inari", "Nishiki market"];
const pins: [number, number][] = [[620, 130], [520, 190], [560, 262], [720, 320], [640, 452], [390, 150]];

export function Map({ p }: { p: number }) {
  const shown = Math.max(1, Math.ceil(p * pins.length));
  const route = `M${pins.map(([x, y]) => `${x} ${y}`).join(" L")}`;
  return (
    <Browser place="map" light>
      <svg width={984} height={549} style={{ position: "absolute", inset: 0 }}>
        <g transform={`translate(${mix(0, -26, p)} ${mix(16, -18, p)})`}>
          <rect x={-60} y={-60} width={1120} height={700} fill="#eef0ea" />
          {Array.from({ length: 150 }, (_, i) => {
            const x = (i % 15) * 74 - 40, y = Math.floor(i / 15) * 64 - 40;
            return <rect key={i} x={x + 5} y={y + 5} width={58 - rand(i) * 18} height={48 - rand(i + 9) * 14} rx={3} fill={rand(i + 4) > 0.86 ? "#cfe6c4" : rand(i + 2) > 0.5 ? "#e3e4dd" : "#e9e7e0"} />;
          })}
          <path d="M300 -60 C340 120 260 260 330 400 S300 620 360 700" stroke="#a9d3ee" strokeWidth={34} fill="none" />
          <path d="M690 -60 C800 80 900 120 1060 110 L1060 -60 Z" fill="#cbe4bd" />
          <path d="M760 280 C840 260 960 330 1060 300 L1060 520 C920 540 800 470 760 400 Z" fill="#cbe4bd" />
          {[90, 226, 350, 490].map((y, i) => (
            <path key={y} d={`M-60 ${y} C260 ${y - 20 + i * 8} 620 ${y + 26} 1060 ${y - 10}`} stroke="#fff" strokeWidth={i === 1 ? 13 : 8} fill="none" />
          ))}
          {[180, 450, 600, 800].map((x, i) => (
            <path key={x} d={`M${x} -60 C${x + 24} 180 ${x - 20} 420 ${x + 12} 700`} stroke={i === 1 ? "#fbe3a2" : "#fff"} strokeWidth={i === 1 ? 14 : 8} fill="none" />
          ))}
          <path d={route} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp(p * 1.05)} stroke="#2563eb" strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" fill="none" />
          {pins.slice(0, shown).map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <path d="M0 0 C-16 -18 -18 -28 -18 -34 A18 18 0 1 1 18 -34 C18 -28 16 -18 0 0" fill="#d6332f" stroke="#fff" strokeWidth={2.5} />
              <text y={-28} textAnchor="middle" fontSize={17} fontWeight={700} fill="#fff" fontFamily={ui}>{i + 1}</text>
            </g>
          ))}
        </g>
      </svg>
      <div style={{ position: "absolute", left: 18, top: 18, width: 262, borderRadius: 14, background: "#fff", boxShadow: "0 6px 24px rgba(0,0,0,0.16)", padding: "16px 18px", boxSizing: "border-box", color: "#1d1d1f" }}>
        <div style={{ fontSize: 21, fontWeight: 650, marginBottom: 2 }}>Kyoto walk</div>
        <div style={{ fontSize: 14, color: "#6e6e73", marginBottom: 12 }}>{(mix(0.4, 9.8, p)).toFixed(1)} km on foot</div>
        {stops.map((s, i) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15.5, padding: "6px 0", opacity: i < shown ? 1 : 0.28 }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, background: "#d6332f", color: "#fff", fontSize: 12.5, fontWeight: 700, display: "grid", placeItems: "center" }}>{i + 1}</span>
            {s}
          </div>
        ))}
      </div>
    </Browser>
  );
}

function Torii({ x, y, s, dark }: { x: number; y: number; s: number; dark: number }) {
  const red = hex("#e2482d", "#7a2417", dark);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-62 -92 Q0 -104 62 -92 L66 -80 Q0 -90 -66 -80 Z" fill={hex("#2a1a16", "#140c0a", dark)} />
      <rect x={-56} y={-80} width={112} height={9} fill={red} />
      <rect x={-50} y={-56} width={100} height={8} fill={red} />
      <rect x={-44} y={-82} width={11} height={92} fill={red} />
      <rect x={33} y={-82} width={11} height={92} fill={red} />
    </g>
  );
}

export function Shrine({ p }: { p: number }) {
  const dusk = part(p, 0.4, 1);
  return (
    <Browser place="shrine" light>
      <div style={{ transform: `translateY(${-p * 210}px)`, fontFamily: serif, color: "#22201c" }}>
        <svg width={984} height={330} style={{ display: "block" }}>
          <defs>
            <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={hex("#9cc6d8", "#2a2350", dusk)} />
              <stop offset="1" stopColor={hex("#f1ead2", "#e58a5a", dusk)} />
            </linearGradient>
          </defs>
          <rect width={984} height={330} fill="url(#dusk)" />
          {Array.from({ length: 40 }, (_, i) => (
            <path key={i} d={`M${i * 26 - 20} 330 l${14 + rand(i) * 8} ${-120 - rand(i + 4) * 120} l${14 + rand(i) * 8} 240 Z`} fill={hex("#54785a", "#1c2b2c", dusk)} opacity={0.9} />
          ))}
          <path d="M400 330 L470 210 L514 210 L600 330 Z" fill={hex("#cfc3a4", "#6c5346", dusk)} />
          {[0.42, 0.55, 0.72, 0.95, 1.25, 1.65].map((s, i) => (
            <Torii key={i} x={492} y={206 + Math.pow(s, 1.5) * 62} s={s} dark={mix(0.55 - i * 0.1, 0.75, dusk)} />
          ))}
        </svg>
        <div style={{ padding: "26px 120px" }}>
          <div style={{ fontSize: 38, fontWeight: 600, marginBottom: 12 }}>Fushimi Inari</div>
          <div style={{ display: "flex", gap: 40, fontSize: 18.5, lineHeight: 1.6 }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: "0 0 14px" }}>Thousands of vermilion gates climb the mountain behind the shrine, each one given by a family or a business.</p>
              <p style={{ margin: "0 0 14px" }}>Go before seven. The path is quiet, the light comes in low between the posts, and the first tea house opens at eight.</p>
              <p style={{ margin: 0 }}>The whole loop takes two to three hours. Most people turn round at the crossing, which has the best view of the city.</p>
            </div>
            <div style={{ width: 220, background: "#f4efe4", borderRadius: 10, padding: 18, fontSize: 16, lineHeight: 1.7, alignSelf: "flex-start" }}>
              <b>Open</b> all day
              <br />
              <b>Climb</b> 233 m
              <br />
              <b>From Kyoto</b> 5 min
              <br />
              <b>Best</b> at first light
            </div>
          </div>
        </div>
      </div>
    </Browser>
  );
}

const rooms: [string, string, string, string, string][] = [
  ["Garden room", "¥38,000", "#36513a", "#89a96f", "#e9d9a8"],
  ["River room", "¥44,000", "#27425c", "#6f9fc0", "#f0c9a0"],
  ["Tatami suite", "¥52,000", "#5a3a2a", "#b98257", "#f3ddb3"],
  ["Tea house", "¥61,000", "#3f2f4e", "#94719e", "#f2c0a4"],
];

export function Stay({ p }: { p: number }) {
  const chosen = Math.min(3, Math.floor(p * 4));
  return (
    <Browser place="stay" light>
      <div style={{ padding: "24px 40px", color: "#1d1d1f" }}>
        <div style={{ fontSize: 30, fontWeight: 650 }}>Ryokan in Gion</div>
        <div style={{ fontSize: 16, color: "#6e6e73", margin: "4px 0 18px" }}>9 to 13 April, two guests</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {rooms.map(([name, price, a, b, lamp], i) => (
            <div key={name} style={{ borderRadius: 14, overflow: "hidden", boxShadow: i === chosen ? "0 0 0 3px #15803d" : "0 0 0 1px rgba(0,0,0,0.1)" }}>
              <svg width={442} height={134} style={{ display: "block" }}>
                <rect width={442} height={134} fill={a} />
                <rect x={0} y={84} width={442} height={50} fill={b} opacity={0.55} />
                {[0, 1, 2, 3, 4].map((k) => (
                  <rect key={k} x={28 + k * 82} y={18} width={70} height={70} fill={lamp} opacity={0.35 + 0.1 * ((k + i) % 3)} stroke={a} strokeWidth={3} />
                ))}
                {[0, 1, 2, 3, 4].map((k) => (
                  <path key={`l${k}`} d={`M${63 + k * 82} 18 v70 M${28 + k * 82} 53 h70`} stroke={a} strokeWidth={2} />
                ))}
                <circle cx={70 + i * 90} cy={110} r={13} fill={lamp} />
                <rect x={230} y={102} width={110} height={12} rx={4} fill={a} />
              </svg>
              <div style={{ padding: "10px 16px 12px", display: "flex", justifyContent: "space-between", fontSize: 17.5 }}>
                <b>{name}</b>
                <span style={{ color: "#6e6e73" }}>{price}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Browser>
  );
}

export function Notes({ p }: { p: number }) {
  const items = ["Flights to Osaka, 9 April", "Ryokan in Gion, four nights", "Fushimi Inari before seven", "Lunch at Nishiki market", "Day trip to Nara", "Tea in Uji on the way back", "Night market on Saturday"];
  const done = Math.round(p * 4) + 1;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#1e1e1e", color: ink.text, fontFamily: ui }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 260, background: "#282828" }}>
        <Lights active x={15} y={15} />
        {["Kyoto in April", "Packing", "Books to read", "Poster ideas"].map((n, i) => (
          <div key={n} style={{ position: "absolute", left: 12, right: 12, top: 60 + i * 62, height: 54, borderRadius: 9, background: i === 0 ? "#b88a1c" : "transparent", padding: "8px 14px", boxSizing: "border-box" }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{n}</div>
            <div style={{ fontSize: 13.5, opacity: 0.65 }}>{["Flights to Osaka", "Light layers", "The old capital", "Lanterns"][i]}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 260, right: 0, top: 0, bottom: 0, padding: "54px 64px" }}>
        <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 22 }}>Kyoto in April</div>
        {items.slice(0, 5 + Math.round(p * 2)).map((text, i) => (
          <div key={text} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 22, padding: "10px 0", color: i < done ? ink.tertiary : ink.text, textDecoration: i < done ? "line-through" : "none" }}>
            <span style={{ width: 25, height: 25, borderRadius: 13, boxSizing: "border-box", border: i < done ? "none" : "2px solid rgba(255,255,255,0.4)", background: i < done ? "#e5b931" : "transparent", color: "#1e1e1e", fontSize: 16, display: "grid", placeItems: "center" }}>{i < done ? "✓" : ""}</span>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}
