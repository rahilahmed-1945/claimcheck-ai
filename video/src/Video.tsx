import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { AppScene, CLICKS } from "./App";
import { CloseScene, ProblemScene, RevealScene } from "./graphics";
import { APP, f, FPS, LINES, SCENES, TOTAL_SECONDS } from "./timeline";
import { Captions, clamp } from "./ui";
import "./theme";

const OVERLAP = 0.5;

/** Crossfade wrapper: fades a scene in and out over its edges with a slight scale. */
const Fade: React.FC<{ length: number; children: React.ReactNode; fadeIn?: boolean; fadeOut?: boolean }> = ({ length, children, fadeIn = true, fadeOut = true }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const inP = fadeIn ? interpolate(t, [0, OVERLAP], [0, 1], clamp) : 1;
  const outP = fadeOut ? interpolate(t, [length - OVERLAP, length], [1, 0], clamp) : 1;
  return <AbsoluteFill style={{ opacity: Math.min(inP, outP) }}>{children}</AbsoluteFill>;
};

const Sfx: React.FC<{ at: number; file: string; volume?: number }> = ({ at, file, volume = 1 }) => (
  <Sequence from={Math.max(0, f(at))} durationInFrames={f(2)} layout="none">
    <Audio src={staticFile(`audio/${file}`)} volume={volume} />
  </Sequence>
);

export const Explainer: React.FC = () => {
  const app = SCENES.app.start;
  const total = f(TOTAL_SECONDS);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence from={0} durationInFrames={f(SCENES.problem.length + OVERLAP)}>
        <Fade length={SCENES.problem.length + OVERLAP} fadeIn={false}>
          <ProblemScene secondLineAt={LINES[1].start - SCENES.problem.start} />
        </Fade>
      </Sequence>
      <Sequence from={f(SCENES.reveal.start)} durationInFrames={f(SCENES.reveal.length + OVERLAP)}>
        <Fade length={SCENES.reveal.length + OVERLAP}>
          <RevealScene />
        </Fade>
      </Sequence>
      <Sequence from={f(SCENES.app.start)} durationInFrames={f(SCENES.app.length + OVERLAP)}>
        <Fade length={SCENES.app.length + OVERLAP}>
          <AppScene />
        </Fade>
      </Sequence>
      <Sequence from={f(SCENES.close.start)} durationInFrames={f(SCENES.close.length)}>
        <Fade length={SCENES.close.length} fadeOut={false}>
          <CloseScene />
        </Fade>
      </Sequence>

      <Captions />

      {/* Narration */}
      {LINES.map((line) => (
        <Sequence key={line.id} from={f(line.start)} durationInFrames={f(line.duration + 0.5)} layout="none">
          <Audio src={staticFile(`voice/${line.id}.wav`)} volume={1} />
        </Sequence>
      ))}

      {/* Original music bed, ducked slightly under the voice and faded at the end. */}
      <Audio
        src={staticFile("audio/music.wav")}
        volume={(frame) => {
          const t = frame / FPS;
          const speaking = LINES.some((line) => t >= line.start - 0.2 && t <= line.start + line.duration + 0.2);
          const fadeOut = interpolate(frame, [total - f(2.5), total], [1, 0], clamp);
          return (speaking ? 0.55 : 0.85) * fadeOut;
        }}
      />

      {/* Sound design */}
      <Sfx at={SCENES.reveal.start + 0.1} file="whoosh.wav" volume={0.5} />
      <Sfx at={SCENES.reveal.start + 0.5} file="chime.wav" volume={0.45} />
      <Sfx at={app + 0.05} file="whoosh.wav" volume={0.45} />
      <Sfx at={app + APP.dropAt} file="drop.wav" volume={0.7} />
      <Sfx at={app + APP.pipelineIn} file="whoosh.wav" volume={0.35} />
      <Sfx at={app + APP.results + 0.5} file="chime.wav" volume={0.3} />
      <Sfx at={app + APP.signalsIn} file="whoosh.wav" volume={0.35} />
      <Sfx at={app + APP.reportIn - 0.2} file="whoosh.wav" volume={0.4} />
      <Sfx at={app + APP.clickMarkdown + 0.9} file="chime.wav" volume={0.3} />
      <Sfx at={SCENES.close.start + 0.1} file="whoosh.wav" volume={0.4} />
      {CLICKS.filter((c) => c !== APP.dropAt).map((c) => (
        <Sfx key={c} at={app + c} file="click.wav" volume={0.8} />
      ))}
      <Sfx at={app + APP.listenStart - 0.2} file="chime.wav" volume={0.22} />
    </AbsoluteFill>
  );
};
