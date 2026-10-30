# ClaimCheck AI explainer video

Source for `submission/claimcheck_explainer.mp4`, a 1920×1080, 30 fps explainer of 117.1 seconds.
This folder is separate from the application: it has its own `package.json` and never imports app code.

## What is real

- **Every application screen is a real capture** of the production build running locally, with the
  synthetic sample paper `samples/claimcheck-demo-paper.pdf`. `scripts/capture.mjs` drives headless
  Chrome through the real workflow:
  1. a real drop event on the upload zone;
  2. the live processing view;
  3. results;
  4. opening F-009 and F-001;
  5. "View in document";
  6. a typed Q&A question and its answer;
  7. a "Confirmed issue" reviewer decision;
  8. a Markdown download through the header control.
- **Scrolling and typing are frame sequences.** Each video frame is a browser screenshot taken after
  the page applied that scroll position or keystroke.
- **Real data only.** The numbers, findings, Table 2, section names, and report text in the motion
  graphics come from that same audit (`public/capture/manifest.json`, `src/report.json`). Nothing is
  invented.

## What is drawn

- **The voice-input scene is an animated illustration**, labelled on screen "Animated illustration · Voice input with Wispr Flow · not a screen recording". The listening pill and waveform are original drawings, not Wispr's UI. The question appears word by word in a copy of the input field that is allowed to wrap. The answer after Ask is the app's real reply to that exact question, captured by `scripts/capture-voice.mjs`. The scene is not evidence of Wispr usage.

- **The cursor and file chip** are animated overlays. Headless screenshots do not include an OS
  cursor. Their targets are the element rectangles recorded during capture.
- **The browser frame and download chip** are drawn. The real download happened in headless Chrome,
  which has no download UI.
- **The opening illustration, logo reveal, pipeline, signals, and closing cards** are original motion
  graphics.

## Audio

- **Narration:** Kokoro-82M (Apache-2.0), run locally through `kokoro-onnx`, voice `af_heart`
  (`scripts/voice.py`). No paid API was used.
- **Music and effects:** synthesized from scratch in `scripts/sfx.mjs`. No third-party audio.

## Rebuild

From `video/`, with the app running on port 8801:

```bash
npm install
npm run capture
node scripts/capture-voice.mjs
npm run sfx
```

Generate the narration:

```bash
python scripts/voice.py kokoro-v1.0.onnx voices-v1.0.bin af_heart
```

Render the video:

```bash
npm run render
```

Start the app for capture from the repository root:

```bash
npm run build
```

```bash
PORT=8801 NODE_ENV=production CLAIMCHECK_DATA_DIR=<empty dir> npx tsx server/src/index.ts
```

Timing is derived from the measured narration lengths in `src/voice-durations.json`, so editing
`src/narration.json` and regenerating the voice keeps picture, captions, and audio in sync.

Remotion is free for individuals and small teams. See remotion.dev/license.
