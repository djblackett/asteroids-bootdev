"""Regenerate the original, procedural 110 ms electrical zap; no external audio source needed."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 22050
rng = random.Random(724)
phase = 0.0
samples = []
for i in range(int(rate * 0.11)):
    t = i / rate
    u = t / 0.11
    phase += 2 * math.pi * (2600 * (1 - u) ** 2 + 260) / rate
    envelope = min(1, t / 0.003) * (1 - u) ** 2
    crackle = rng.uniform(-1, 1) * (0.22 + 0.12 * math.sin(t * 720))
    value = envelope * (0.52 * math.sin(phase) + 0.17 * math.sin(phase * 2.07) + crackle)
    samples.append(struct.pack('<h', int(max(-1, min(1, value)) * 26000)))

path = Path(__file__).resolve().parents[1] / 'public/audio/sfx/lightning.wav'
with wave.open(str(path), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(rate)
    output.writeframes(b''.join(samples))
