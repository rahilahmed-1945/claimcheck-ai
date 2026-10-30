import { continueRender, delayRender, staticFile } from "remotion";

/** Palette taken from the application's own CSS variables, plus a dark stage for the film. */
export const C = {
  bg: "#f4f1e9",
  surface: "#fbfaf5",
  ink: "#1c2521",
  muted: "#6b756f",
  line: "#e0dbcd",
  accent: "#146356",
  accentInk: "#0b3d35",
  accentWash: "#e6f0eb",
  danger: "#9c392d",
  dangerWash: "#f9eae5",
  amber: "#a8741f",
  slate: "#4f6378",
  stage: "#0b1613",
  stage2: "#10211c",
  ivory: "#f3eee2",
  gold: "#d9c49a",
};

export const SERIF = "'Newsreader', Georgia, serif";
export const SANS = "'Inter', 'Segoe UI', sans-serif";
export const MONO = "'IBM Plex Mono', Consolas, monospace";

const fonts: [string, string, FontFaceDescriptors][] = [
  ["Newsreader", "fonts/newsreader-latin-wght-normal.woff2", { weight: "200 800", style: "normal" }],
  ["Newsreader", "fonts/newsreader-latin-wght-italic.woff2", { weight: "200 800", style: "italic" }],
  ["Inter", "fonts/inter-latin-wght-normal.woff2", { weight: "100 900", style: "normal" }],
  ["IBM Plex Mono", "fonts/ibm-plex-mono-latin-400-normal.woff2", { weight: "400", style: "normal" }],
  ["IBM Plex Mono", "fonts/ibm-plex-mono-latin-500-normal.woff2", { weight: "500", style: "normal" }],
];

const handle = delayRender("Loading fonts");
Promise.all(
  fonts.map(async ([family, file, descriptors]) => {
    const face = new FontFace(family, `url(${staticFile(file)})`, descriptors);
    await face.load();
    document.fonts.add(face);
  }),
)
  .then(() => continueRender(handle))
  .catch((error) => {
    console.error(error);
    continueRender(handle);
  });
