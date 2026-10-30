"""Generate the narration locally with Kokoro (Apache-2.0 model, runs offline).

Writes one WAV per narration line to public/voice/ and their durations to
src/voice-durations.json, which the Remotion timeline uses for sync.

    python scripts/voice.py <kokoro-v1.0.onnx> <voices-v1.0.bin> [voice]
"""
import json
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).resolve().parent.parent
model, voices = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "af_heart"
lines = json.loads((root / "src" / "narration.json").read_text(encoding="utf-8"))
out = root / "public" / "voice"
out.mkdir(parents=True, exist_ok=True)

kokoro = Kokoro(model, voices)
durations = {}
for line in lines:
    samples, rate = kokoro.create(line["text"], voice=voice, speed=0.98, lang="en-us")
    sf.write(out / f"{line['id']}.wav", samples, rate)
    durations[line["id"]] = round(len(samples) / rate, 3)
    print(f"{line['id']}: {durations[line['id']]:.2f}s")

(root / "src" / "voice-durations.json").write_text(json.dumps({"voice": voice, "durations": durations}, indent=2))
print(f"total speech: {sum(durations.values()):.1f}s")
