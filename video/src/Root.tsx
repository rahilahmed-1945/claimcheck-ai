import React from "react";
import { Composition } from "remotion";
import { Explainer } from "./Video";
import { f, FPS, TOTAL_SECONDS } from "./timeline";

export const Root: React.FC = () => (
  <Composition id="ClaimCheckExplainer" component={Explainer} durationInFrames={f(TOTAL_SECONDS)} fps={FPS} width={1920} height={1080} />
);
