import React from "react";
import { Browser, clamp, hex, mix, mono, part, rand, ui } from "./kit";

// A launch watched all day: hours of countdown, then a minute of fire, then the sky going dark. Drawn so that running
// along the day's screens is running along the flight.

const W = 984, H = 549;
const liftoff = 0.46, staging = 0.7, space = 0.78;

export function Launch({ p }: { p: number }) {
  const up = part(p, liftoff, staging);
  const inSpace = p >= space;
  return (
    <Browser place="launch">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", left: 0, top: 0 }}>
        <Sky p={p} />
        {!inSpace && <Ground p={p} up={up} />}
        {inSpace ? <Orbit p={part(p, space, 1)} /> : <Flight p={p} up={up} />}
      </svg>
      <Hud p={p} />
    </Browser>
  );
}

function Sky({ p }: { p: number }) {
  const day = part(p, 0, 0.4), dark = part(p, liftoff + 0.06, space);
  const top = p < liftoff ? hex("#1a2048", "#2f6fb8", day) : hex("#2f6fb8", "#02030a", dark);
  const middle = p < liftoff ? hex("#7a4a6e", "#7db4e0", day) : hex("#7db4e0", "#050a1e", dark);
  const low = p < liftoff ? hex("#f2a46a", "#e8f1f7", day) : hex("#e8f1f7", "#0b1a3d", dark);
  return (
    <>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="0.62" stopColor={middle} />
          <stop offset="1" stopColor={low} />
        </linearGradient>
        <radialGradient id="glow">
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset="0.25" stopColor="#ffd27a" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#ff8a3c" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ff6a2c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="body" x1="0" x2="1">
          <stop offset="0" stopColor="#c9ced6" />
          <stop offset="0.35" stopColor="#ffffff" />
          <stop offset="1" stopColor="#9aa3b0" />
        </linearGradient>
        <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.2" stopColor="#ffe9a8" />
          <stop offset="0.55" stopColor="#ff9a3c" />
          <stop offset="1" stopColor="#ff5a1f" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#sky)" />
      {Array.from({ length: 130 }, (_, i) => (
        <circle key={i} cx={rand(i) * W} cy={rand(i + 500) * H * 0.9} r={0.5 + rand(i + 900) * 1.2} fill="#fff" opacity={dark * (0.3 + 0.7 * rand(i + 70))} />
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <ellipse key={`c${i}`} cx={((rand(i + 20) * 1300 + p * 900) % 1300) - 150} cy={60 + rand(i + 40) * 190 + part(p, liftoff, staging) * 700} rx={70 + rand(i) * 90} ry={10 + rand(i + 3) * 12} fill="#fff" opacity={0.18 + 0.12 * rand(i + 8)} />
      ))}
    </>
  );
}

function Ground({ p, up }: { p: number; up: number }) {
  const y = 430 + up * 900;
  const steam = part(p, 0.18, 0.42);
  const fire = part(p, liftoff - 0.012, liftoff + 0.03) * (1 - part(p, liftoff + 0.1, liftoff + 0.16));
  return (
    <g transform={`translate(0 ${y - 430})`}>
      <rect x={0} y={430} width={W} height={200} fill={hex("#141526", "#2c4a3f", part(p, 0.05, 0.4))} />
      <rect x={0} y={452} width={W} height={10} fill="#8fb6cf" opacity={0.28} />
      {Array.from({ length: 46 }, (_, i) => (
        <rect key={i} x={i * 22 - 6} y={424 - rand(i) * 12} width={26} height={30} rx={10} fill={hex("#0f1120", "#223c33", part(p, 0.05, 0.4))} />
      ))}
      {/* the tower */}
      <g transform="translate(430 0)">
        <rect x={0} y={150} width={34} height={284} fill="none" stroke="#5c6470" strokeWidth={3} />
        {Array.from({ length: 10 }, (_, i) => (
          <path key={i} d={`M0 ${150 + i * 28.4} L34 ${178.4 + i * 28.4} M34 ${150 + i * 28.4} L0 ${178.4 + i * 28.4}`} stroke="#5c6470" strokeWidth={1.6} />
        ))}
        <rect x={34} y={186} width={mix(40, 14, part(p, 0.28, 0.36))} height={8} fill="#79828f" />
        <rect x={34} y={300} width={mix(40, 20, part(p, 0.36, 0.42))} height={7} fill="#79828f" />
        <circle cx={17} cy={144} r={3} fill="#ff5a4f" />
      </g>
      <rect x={452} y={420} width={110} height={16} rx={3} fill="#555d68" />
      {fire > 0 && <ellipse cx={508} cy={436} rx={260 * fire} ry={120 * fire} fill="url(#glow)" />}
      {Array.from({ length: 34 }, (_, i) => {
        const side = i % 2 ? 1 : -1;
        const grow = p < liftoff ? steam * 0.5 : 0.5 + part(p, liftoff, liftoff + 0.09) * 1.4;
        const away = rand(i + 5) * (p < liftoff ? 80 * steam : 80 + 330 * part(p, liftoff, liftoff + 0.1));
        return <circle key={i} cx={508 + side * away} cy={434 - rand(i + 11) * 26 * grow} r={(10 + rand(i + 2) * 26) * grow} fill={i % 3 ? "#f3f5f7" : "#d9dee4"} opacity={(p < liftoff ? 0.35 : 0.8) * (steam > 0 ? 1 : 0)} />;
      })}
    </g>
  );
}

function Rocket({ flame = 0, upper = true, lower = true }: { flame?: number; upper?: boolean; lower?: boolean }) {
  return (
    <g>
      {flame > 0 && (
        <>
          <ellipse cx={0} cy={118} rx={70 * flame} ry={110 * flame} fill="url(#glow)" opacity={0.9} />
          <path d={`M-11 104 Q0 ${150 + 170 * flame} 11 104 Z`} fill="url(#flame)" />
        </>
      )}
      {lower && (
        <>
          <rect x={-14} y={-30} width={28} height={134} rx={3} fill="url(#body)" />
          <rect x={-14} y={20} width={28} height={5} fill="#2b3038" />
          <path d="M-14 78 L-28 108 L-14 102 Z M14 78 L28 108 L14 102 Z" fill="#39404a" />
          <rect x={-9} y={102} width={18} height={8} fill="#22262c" />
        </>
      )}
      {upper && (
        <>
          <rect x={-13} y={-92} width={26} height={60} rx={3} fill="url(#body)" />
          <path d="M-13 -92 Q-13 -128 0 -142 Q13 -128 13 -92 Z" fill="#eef1f5" />
          <rect x={-13} y={-66} width={26} height={14} fill="#e0533d" />
        </>
      )}
    </g>
  );
}

function Flight({ p, up }: { p: number; up: number }) {
  const lift = part(p, liftoff + 0.01, liftoff + 0.1);
  const high = part(p, liftoff + 0.1, staging);
  const apart = part(p, staging, space);
  const y = mix(mix(318, 250, lift), 300, high);
  const tilt = high * 24;
  const size = mix(1, 0.92, high);
  if (apart > 0)
    return (
      <g transform={`translate(492 270) rotate(30) scale(0.95)`}>
        <circle cx={0} cy={-30 + apart * 40} r={26 + 60 * apart} fill="url(#glow)" opacity={0.7 * (1 - apart)} />
        <g transform={`translate(${-30 * apart} ${140 * apart}) rotate(${-26 * apart})`} opacity={1 - 0.3 * apart}>
          <Rocket upper={false} />
        </g>
        <g transform={`translate(0 ${-70 * apart})`}>
          {apart > 0.3 && <path d="M-7 -30 Q0 70 7 -30 Z" fill="#9fd2ff" opacity={0.85} />}
          <Rocket lower={false} />
        </g>
      </g>
    );
  return (
    <g transform={`translate(${508 + high * 10} ${y}) rotate(${tilt}) scale(${size})`}>
      <Rocket flame={up > 0 ? 0.75 + 0.35 * rand(Math.round(p * 400)) * lift + 0.25 : part(p, liftoff - 0.015, liftoff) * 0.6} />
    </g>
  );
}

function Orbit({ p }: { p: number }) {
  const open = part(p, 0.35, 0.7);
  return (
    <>
      <defs>
        <radialGradient id="earth" cx="0.5" cy="0.42" r="0.58">
          <stop offset="0" stopColor="#1f5f9c" />
          <stop offset="0.8" stopColor="#123f73" />
          <stop offset="0.965" stopColor="#3f8fd0" />
          <stop offset="1" stopColor="#bfe3ff" />
        </radialGradient>
      </defs>
      <circle cx={W / 2 - 60} cy={1120 - p * 50} r={764} fill="#6db7f2" opacity={0.2} />
      <circle cx={W / 2 - 60} cy={1120 - p * 50} r={744} fill="url(#earth)" />
      {Array.from({ length: 16 }, (_, i) => (
        <ellipse key={i} cx={((rand(i + 60) * 1200 - p * 260 + 1200) % 1200) - 100} cy={470 + rand(i + 80) * 90} rx={40 + rand(i) * 80} ry={3 + rand(i + 1) * 5} fill="#fff" opacity={0.28} transform="rotate(-2)" />
      ))}
      <circle cx={860} cy={84} r={150} fill="url(#glow)" opacity={0.55} />
      <circle cx={860} cy={84} r={22} fill="#fffaf0" />
      <g transform={`translate(${mix(430, 520, p)} ${mix(260, 214, p)}) rotate(${mix(38, 12, p)}) scale(1.15)`}>
        <rect x={-16 - 118 * open} y={-12} width={118 * open} height={30} fill="#2b4b8f" stroke="#8fb0ea" strokeWidth={1.2} />
        <rect x={16} y={-12} width={118 * open} height={30} fill="#2b4b8f" stroke="#8fb0ea" strokeWidth={1.2} />
        {[1, 2, 3, 4].map((i) => (
          <path key={i} d={`M${16 + 118 * open * (i / 5)} -12 v30 M${-16 - 118 * open * (i / 5)} -12 v30`} stroke="#8fb0ea" strokeWidth={0.8} />
        ))}
        <rect x={-16} y={-34} width={32} height={74} rx={4} fill="url(#body)" />
        <rect x={-16} y={-10} width={32} height={13} fill="#e0533d" />
        <path d="M-16 -34 Q-12 -60 0 -64 Q12 -60 16 -34 Z" fill="#eef1f5" />
        <path d="M-8 40 L8 40 L13 56 L-13 56 Z" fill="#39404a" />
      </g>
    </>
  );
}

function Hud({ p }: { p: number }) {
  const t = p < liftoff ? -Math.round(mix(9060, 10, Math.pow(p / liftoff, 0.8))) : Math.round(mix(0, 3120, Math.pow((p - liftoff) / (1 - liftoff), 1.7)));
  const s = Math.abs(t);
  const time = `T${t < 0 ? "−" : "+"}${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const climb = part(p, liftoff, 1);
  const speed = Math.round(27600 * Math.pow(climb, 1.6)), altitude = Math.round(412 * Math.pow(climb, 1.5));
  const marks: [number, string][] = [[0.02, "Fuelling"], [liftoff, "Liftoff"], [staging, "Separation"], [space + 0.06, "Orbit"]];
  const chat = p < liftoff
    ? ["first time watching live", "clouds are clearing", "go Halcyon", "is that the arm?", "ten minutes!"]
    : p < space ? ["WE HAVE LIFTOFF", "the sound!!", "look at that plume", "max pressure passed", "clean separation"] : ["so quiet up there", "panels out", "hello, Earth", "what a view", "nominal orbit"];
  const at = Math.floor(p * 37);
  const text = { color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,0.5)" } as const;
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: ui, ...text }}>
      <div style={{ position: "absolute", left: 24, top: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ background: "#e5484d", borderRadius: 6, padding: "3px 10px", fontSize: 14, fontWeight: 700, textShadow: "none" }}>LIVE</span>
        <span style={{ fontSize: 21, fontWeight: 600 }}>Halcyon 3</span>
        <span style={{ fontSize: 17, opacity: 0.8 }}>Lunar relay</span>
      </div>
      <div style={{ position: "absolute", right: 24, top: 20, fontFamily: mono, fontSize: 30, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{time}</div>
      <div style={{ position: "absolute", right: 24, bottom: 92, width: 210, display: "flex", flexDirection: "column", gap: 7, fontSize: 15 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ opacity: 0.55 + 0.2 * i }}>
            <b style={{ opacity: 0.75 }}>{["ines", "tomo", "kai", "bea", "ro"][(at + i) % 5]}</b> {chat[(at + i) % 5]}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 140, background: "linear-gradient(transparent, rgba(0,0,0,0.6))" }} />
      <div style={{ position: "absolute", left: 24, bottom: 44, display: "flex", gap: 34 }}>
        {[["Speed", speed.toLocaleString("en-GB"), "km/h"], ["Altitude", String(altitude), "km"]].map(([name, value, unit]) => (
          <div key={name}>
            <div style={{ fontSize: 13, opacity: 0.7 }}>{name}</div>
            <div style={{ fontSize: 27, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {value} <span style={{ fontSize: 15, opacity: 0.7 }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 22, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.25)" }}>
        <div style={{ width: `${clamp(p) * 100}%`, height: 4, borderRadius: 2, background: "#fff" }} />
        {marks.map(([x, name]) => (
          <div key={name} style={{ position: "absolute", left: `${x * 100}%`, top: -3, width: 10, height: 10, borderRadius: 5, background: p >= x ? "#fff" : "rgba(255,255,255,0.5)" }} />
        ))}
      </div>
    </div>
  );
}
