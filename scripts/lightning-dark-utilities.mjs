// Genera las reglas de modo oscuro de Lightning para las clases de color fijas (bg-white,
// text-slate-500, bg-green-100…) que usan los componentes compartidos con la vista clásica.
// Así el modo oscuro no obliga a tocar cada pantalla y la vista clásica queda igual.
//   node scripts/lightning-dark-utilities.mjs   -> reescribe el bloque marcado en src/lightning.css
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import colors from "tailwindcss/colors.js";

const NEUTRAL = ["white", "black", "gray", "slate", "zinc", "neutral", "stone"];
const HUES = ["red", "green", "emerald", "blue", "sky", "amber", "yellow", "orange", "rose", "indigo", "violet", "purple", "teal", "cyan", "lime", "pink", "fuchsia"];
const CLASS = new RegExp(String.raw`(?<![\w-])((?:hover|focus|focus-visible):)?(bg|text|border|divide|ring|outline)-(${[...NEUTRAL, ...HUES].join("|")})(?:-(\d{2,3}))?(?:/(\d+))?(?![\w-])`, "g");

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
  }
};
walk("src");
const found = new Map();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(CLASS)) found.set(m[0], m);

const rgb = (hex, a) => {
  const [r, g, b] = hex.match(/\w\w/g).map((h) => parseInt(h, 16));
  return a == null ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
};
const esc = (cls) => cls.replace(/[:/[\]#.]/g, (c) => "\\" + c);

/** Valor oscuro para una clase, o null si se deja como está (colores sólidos que ya funcionan). */
function darkValue(prop, family, shade, alpha) {
  const n = Number(shade ?? 0);
  if (NEUTRAL.includes(family)) {
    if (prop === "bg") {
      if (family === "black") return null;
      if (family === "white") return alpha && Number(alpha) <= 20 ? null : alpha ? `color-mix(in srgb, var(--lx-surface) ${alpha}%, transparent)` : "var(--lx-surface)";
      if (n <= 50) return "var(--lx-surface-2)";
      if (n <= 100) return "var(--lx-surface-3)";
      if (n <= 200) return "var(--lx-border)";
      if (n <= 400) return "var(--lx-border-strong)";
      return null;
    }
    if (prop === "text") {
      if (family === "white") return null;
      if (family === "black" || n >= 900) return "var(--lx-ink)";
      if (n >= 700) return "var(--lx-ink-soft)";
      if (n >= 500) return "var(--lx-muted)";
      return "var(--lx-subtle)";
    }
    if (prop === "border" || prop === "divide") {
      if (family === "white") return alpha ? null : "var(--lx-surface)";
      return n >= 300 ? "var(--lx-border-strong)" : "var(--lx-border)";
    }
    return null;
  }
  const c = colors[family];
  if (prop === "bg") {
    if (n <= 50) return rgb(c[500], 0.1);
    if (n <= 100) return rgb(c[500], 0.17);
    if (n <= 200) return rgb(c[500], 0.26);
    if (n <= 300) return rgb(c[500], 0.36);
    return null; // 400+ son sólidos (puntos, botones): se ven bien en oscuro
  }
  if (prop === "text") {
    if (n >= 900) return c[200];
    if (n >= 700) return c[300];
    if (n >= 500) return c[400];
    return null;
  }
  if (prop === "border" || prop === "divide") return n <= 200 ? rgb(c[500], 0.32) : n <= 300 ? rgb(c[500], 0.48) : null;
  if ((prop === "ring" || prop === "outline") && family === "blue") return "var(--lx-primary)";
  return null;
}

/** Modo claro: solo los grises neutros pasan a los tonos menta del tema (más armonía y mejor contraste). */
function lightValue(prop, family, shade) {
  if (!NEUTRAL.includes(family) || family === "white" || family === "black") return null;
  const n = Number(shade ?? 0);
  if (prop === "bg") return n === 50 ? "var(--lx-surface-2)" : n === 100 ? "var(--lx-surface-3)" : null;
  if (prop === "text") return n === 500 ? "var(--lx-muted)" : null;
  if (prop === "border" || prop === "divide") return n >= 100 && n <= 200 ? "var(--lx-border)" : n === 300 ? "var(--lx-border-strong)" : null;
  return null;
}

/** Color original de Tailwind: un hover/focus que no se traduce debe seguir ganándole a la clase base ya traducida. */
function original(prop, family, shade, alpha) {
  if (!["bg", "text", "border"].includes(prop)) return null;
  const hex = family === "white" ? "#ffffff" : family === "black" ? "#000000" : colors[family]?.[shade];
  if (!hex) return null;
  return alpha ? rgb(hex, Number(alpha) / 100) : hex;
}

const THEMES = [
  { selector: '[data-design="lightning"][data-theme="dark"]', value: darkValue },
  { selector: '[data-design="lightning"]:not([data-theme="dark"])', value: lightValue },
];
const lines = [];
for (const { selector: D, value: themeValue } of THEMES) {
  for (const [cls, m] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const [, variant, prop, family, shade, alpha] = m;
    const pseudo = variant === "hover:" ? ":hover" : variant === "focus:" ? ":focus" : variant === "focus-visible:" ? ":focus-visible" : "";
    let value = themeValue(prop, family, shade, alpha);
    if (!value && variant && variant !== "focus-visible:") value = original(prop, family, shade, alpha);
    if (!value) continue;
    const sel = `${D} .${esc(cls)}${pseudo}`;
    if (prop === "bg") lines.push(`${sel} { background-color: ${value}; }`);
    else if (prop === "text") lines.push(`${sel} { color: ${value}; }`);
    else if (prop === "border") lines.push(`${sel} { border-color: ${value}; }`);
    else if (prop === "divide") lines.push(`${D} .${esc(cls)} > :not([hidden]) ~ :not([hidden]) { border-color: ${value}; }`);
    else if (prop === "ring") lines.push(`${sel} { --tw-ring-color: ${value}; }`);
    else if (prop === "outline") lines.push(`${sel} { outline-color: ${value}; }`);
  }
}

const START = "/* @generated dark-utilities:start (node scripts/lightning-dark-utilities.mjs) */";
const END = "/* @generated dark-utilities:end */";
const path = "src/lightning.css";
const css = readFileSync(path, "utf8");
const block = `${START}\n${lines.join("\n")}\n${END}`;
const from = css.indexOf(START);
const to = css.indexOf(END);
const next = from >= 0 && to > from ? css.slice(0, from) + block + css.slice(to + END.length) : `${css.trimEnd()}\n\n${block}\n`;
writeFileSync(path, next);
console.log(`${lines.length} reglas (claro + oscuro) para ${found.size} clases`);
