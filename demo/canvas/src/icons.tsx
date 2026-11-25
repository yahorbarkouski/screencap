import React from "react";
import { AbsoluteFill } from "remotion";

/** The icons of the made-up sites (and of GitHub, whose mark is not drawn here). */
export const icons: Record<string, [string, React.ReactNode]> = {
  "skycast.example": ["#0b1a3d", <path key="i" d="M32 8 C42 18 44 32 40 44 L24 44 C20 32 22 18 32 8 M24 38 L14 50 L24 48 M40 38 L50 50 L40 48 M28 48 L32 60 L36 48" fill="#fff" />],
  "github.com": ["#24292f", <g key="i" stroke="#fff" strokeWidth={5} fill="none"><circle cx={20} cy={18} r={6} /><circle cx={20} cy={46} r={6} /><circle cx={44} cy={24} r={6} /><path d="M20 24 V40 M44 30 C44 42 30 36 22 42" /></g>],
  "grammarnotes.example": ["#0969da", <text key="i" x={32} y={46} textAnchor="middle" fontSize={40} fontWeight={700} fill="#fff" fontFamily="Georgia">G</text>],
  "atlas.example": ["#2f9e62", <path key="i" d="M32 56 C18 38 16 30 16 26 A16 16 0 1 1 48 26 C48 30 46 38 32 56 M32 20 a6 6 0 1 0 0.1 0" fill="#fff" fillRule="evenodd" />],
  "wayfarer.example": ["#d6432b", <path key="i" d="M8 16 Q32 10 56 16 V22 Q32 17 8 22 Z M14 30 H50 V35 H14 Z M17 22 H23 V56 H17 Z M41 22 H47 V56 H41 Z" fill="#fff" />],
  "stay.example": ["#7c3f58", <path key="i" d="M10 34 L32 14 L54 34 H48 V54 H16 V34 Z" fill="#fff" />],
  "easel.example": ["#6d4aff", <g key="i" fill="#fff"><circle cx={24} cy={26} r={14} /><path d="M30 54 L56 54 L43 30 Z" opacity={0.85} /></g>],
  "pinwall.example": ["#c2410c", <g key="i" fill="#fff"><rect x={12} y={12} width={18} height={26} rx={4} /><rect x={34} y={12} width={18} height={16} rx={4} /><rect x={12} y={42} width={18} height={10} rx={4} /><rect x={34} y={32} width={18} height={20} rx={4} /></g>],
  "pages.example": ["#2563eb", <path key="i" d="M18 10 H38 L48 20 V54 H18 Z M25 28 H41 M25 36 H41 M25 44 H35" fill="#fff" stroke="#2563eb" strokeWidth={3} />],
  "relay.example": ["#4a2a68", <path key="i" d="M12 14 H52 V42 H30 L20 52 V42 H12 Z" fill="#fff" />],
  "openfile.example": ["#5f7d45", <path key="i" d="M32 8 a8 8 0 0 1 5 14 L41 34 H44 V40 L46 54 H18 L20 40 V34 H23 L27 22 A8 8 0 0 1 32 8" fill="#fff" />],
  "keyhole.example": ["#0e7490", <path key="i" d="M32 12 a12 12 0 0 1 6 22 L42 54 H22 L26 34 A12 12 0 0 1 32 12" fill="#fff" />],
  "stride.example": ["#059669", <path key="i" d="M10 44 L26 24 L36 36 L54 14" fill="none" stroke="#fff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />],
  "crumb.example": ["#b87a3c", <path key="i" d="M12 40 C10 20 54 20 52 40 V48 H12 Z" fill="#fff" />],
  "ledger.example": ["#475569", <path key="i" d="M16 14 H48 M16 26 H48 M16 38 H36 M16 50 H30" stroke="#fff" strokeWidth={6} strokeLinecap="round" />],
  "skylark.example": ["#3b82c4", <circle key="i" cx={32} cy={32} r={15} fill="#ffd76a" />],
};
export const hosts = Object.keys(icons);

export function Icon({ host }: { host: string }) {
  const [color, art] = icons[host];
  return (
    <AbsoluteFill>
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <rect width={64} height={64} rx={14} fill={color} />
        {art}
      </svg>
    </AbsoluteFill>
  );
}
