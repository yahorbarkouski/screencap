import React from "react";
import { Img, staticFile } from "remotion";
import { Lights } from "../../../resume/src/apps";
import { ink, mono, ui } from "../../../resume/src/theme";
import { places, PlaceID } from "../day";

export { ink, mono, ui };
export const serif = 'ui-serif, "New York", Georgia, serif';
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** How far `p` is through `from`…`to`. */
export const part = (p: number, from: number, to: number) => clamp((p - from) / (to - from));
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
/** A repeatable random number. */
export const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const hex = (a: string, b: string, p: number) => {
  const v = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(mix(v(a, i), v(b, i), clamp(p)))).join(",")})`;
};

/** A site's icon, as drawn for the app too. */
export function SiteIcon({ host, size }: { host: string; size: number }) {
  return <Img src={staticFile(`generated/icons/${host}.png`)} style={{ width: size, height: size, borderRadius: size * 0.22, flex: "none", display: "block" }} />;
}

/** The browser around a page: its tab, its address, and the page under them. */
export function Browser({ place, light, children }: { place: PlaceID; light?: boolean; children: React.ReactNode }) {
  const { title, host, path } = places[place];
  const bar = light ? "#f1f1f3" : "#1f1f23";
  const text = light ? "#1d1d1f" : "#ededea";
  return (
    <div style={{ position: "absolute", inset: 0, background: bar, color: text, fontFamily: ui }}>
      <Lights active x={15} y={15} />
      <div style={{ position: "absolute", left: 86, top: 7, height: 29, borderRadius: 8, padding: "0 13px 0 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, background: light ? "#fff" : "rgba(255,255,255,0.12)" }}>
        <SiteIcon host={host!} size={16} />
        {title.split(" · ")[0]}
      </div>
      <div style={{ position: "absolute", right: 14, top: 7, width: 300, height: 29, borderRadius: 8, background: light ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 12px", boxSizing: "border-box", fontSize: 12.5, opacity: 0.75, overflow: "hidden", whiteSpace: "nowrap" }}>
        {host}
        {path}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 43, bottom: 0, overflow: "hidden", background: light ? "#fff" : "#111214" }}>{children}</div>
    </div>
  );
}
