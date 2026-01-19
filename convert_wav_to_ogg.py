#!/usr/bin/env python3
"""Convert .wav files to .ogg and remove originals if successful."""

import subprocess
import sys
from pathlib import Path


def convert_wav_to_ogg(directory: str = "./sound-effects") -> None:
    """Convert all .wav files in directory to .ogg format."""
    path = Path(directory)

    if not path.exists():
        print(f"Directory not found: {directory}")
        sys.exit(1)

    wav_files = list(path.glob("**/*.wav"))

    if not wav_files:
        print("No .wav files found.")
        return

    print(f"Found {len(wav_files)} .wav file(s) to convert:\n")

    converted = 0
    failed = 0

    for wav_file in wav_files:
        ogg_file = wav_file.with_suffix(".ogg")

        # Skip if .ogg already exists
        if ogg_file.exists():
            print(f"  SKIP: {wav_file.name} -> .ogg already exists")
            continue

        print(f"  Converting: {wav_file.name} -> {ogg_file.name}...", end=" ")

        try:
            # Use ffmpeg to convert
            result = subprocess.run(
                ["ffmpeg", "-i", str(wav_file), "-c:a",
                 "libvorbis", "-q:a", "6", str(ogg_file)],
                capture_output=True,
                text=True
            )

            if result.returncode == 0 and ogg_file.exists():
                # Conversion successful, remove original
                wav_file.unlink()
                print("OK (removed .wav)")
                converted += 1
            else:
                print(
                    f"FAILED: {result.stderr[:100] if result.stderr else 'Unknown error'}")
                failed += 1

        except FileNotFoundError:
            print("FAILED: ffmpeg not found. Install ffmpeg and try again.")
            sys.exit(1)
        except Exception as e:
            print(f"FAILED: {e}")
            failed += 1

    print(f"\nDone: {converted} converted, {failed} failed")


if __name__ == "__main__":
    directory = sys.argv[1] if len(sys.argv) > 1 else "./sound-effects"
    convert_wav_to_ogg(directory)
