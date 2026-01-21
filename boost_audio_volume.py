#!/usr/bin/env python3
"""
Boost audio volume with clipping prevention.

This script increases the volume of audio files while ensuring
the output doesn't clip (exceed maximum amplitude).

Usage:
    python boost_audio_volume.py <input_file> <gain_db> [output_file]
    python boost_audio_volume.py sound-effects/player-death.ogg 6
    python boost_audio_volume.py sound-effects/boost-woosh.ogg 3 boosted.ogg

Arguments:
    input_file: Path to the audio file to boost
    gain_db: Desired gain in decibels (e.g., 6 = roughly double perceived loudness)
    output_file: Optional output path (default: overwrites input)

The script will:
1. Analyze the audio to find current peak level
2. Calculate maximum safe gain to avoid clipping
3. Apply the lesser of requested gain or safe gain
4. Report what was actually applied
"""

import subprocess
import sys
import os
import json
import tempfile
import shutil


def get_audio_stats(filepath):
    """Analyze audio file and return peak level and other stats."""
    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "-select_streams", "a:0",
        filepath
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    return json.loads(result.stdout)


def get_peak_level(filepath):
    """Get the peak amplitude level in dB using ffmpeg's volumedetect filter."""
    cmd = [
        "ffmpeg",
        "-i", filepath,
        "-af", "volumedetect",
        "-f", "null",
        "-"
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    # volumedetect outputs to stderr
    output = result.stderr

    # Parse max_volume from output like: max_volume: -6.2 dB
    for line in output.split('\n'):
        if 'max_volume' in line:
            parts = line.split(':')
            if len(parts) >= 2:
                db_str = parts[-1].strip().replace('dB', '').strip()
                return float(db_str)

    raise RuntimeError("Could not determine peak volume level")


def boost_audio(input_file, gain_db, output_file=None):
    """
    Boost audio volume with clipping prevention.

    Args:
        input_file: Path to input audio file
        gain_db: Desired gain in decibels
        output_file: Output path (None = overwrite input)

    Returns:
        dict with applied_gain_db and peak_after_db
    """
    if not os.path.exists(input_file):
        raise FileNotFoundError(f"Input file not found: {input_file}")

    # Analyze current peak level
    print(f"Analyzing: {input_file}")
    current_peak_db = get_peak_level(input_file)
    print(f"  Current peak level: {current_peak_db:.1f} dB")

    # Calculate headroom (how much we can boost before clipping)
    # 0 dB is the maximum, so headroom = 0 - current_peak
    headroom_db = 0 - current_peak_db
    print(f"  Available headroom: {headroom_db:.1f} dB")

    # Determine actual gain to apply (don't exceed headroom)
    if gain_db > headroom_db:
        actual_gain_db = headroom_db
        print(f"  Requested gain ({gain_db:.1f} dB) exceeds headroom, limiting to {actual_gain_db:.1f} dB")
    else:
        actual_gain_db = gain_db
        print(f"  Applying requested gain: {actual_gain_db:.1f} dB")

    if actual_gain_db <= 0.1:
        print("  Audio is already at or near maximum level, no boost applied.")
        return {
            "applied_gain_db": 0,
            "peak_before_db": current_peak_db,
            "peak_after_db": current_peak_db
        }

    # Determine output path
    overwrite = output_file is None
    if overwrite:
        # Use temp file for atomic overwrite
        fd, temp_output = tempfile.mkstemp(suffix=os.path.splitext(input_file)[1])
        os.close(fd)
        output_file = temp_output

    # Apply gain with ffmpeg
    cmd = [
        "ffmpeg",
        "-y",  # Overwrite output
        "-i", input_file,
        "-af", f"volume={actual_gain_db}dB",
        "-c:a", "libvorbis",  # OGG Vorbis codec
        "-q:a", "6",  # Quality level
        output_file
    ]

    print(f"  Boosting audio...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        if overwrite and os.path.exists(temp_output):
            os.remove(temp_output)
        raise RuntimeError(f"ffmpeg failed: {result.stderr}")

    # If overwriting, move temp file to original
    if overwrite:
        shutil.move(temp_output, input_file)
        final_output = input_file
    else:
        final_output = output_file

    # Verify the result
    new_peak_db = get_peak_level(final_output)
    print(f"  New peak level: {new_peak_db:.1f} dB")
    print(f"  Done! Output: {final_output}")

    return {
        "applied_gain_db": actual_gain_db,
        "peak_before_db": current_peak_db,
        "peak_after_db": new_peak_db
    }


def normalize_audio(input_file, target_peak_db=-1.0, output_file=None):
    """
    Normalize audio to a target peak level.

    Args:
        input_file: Path to input audio file
        target_peak_db: Target peak level (default -1.0 dB for safety margin)
        output_file: Output path (None = overwrite input)
    """
    if not os.path.exists(input_file):
        raise FileNotFoundError(f"Input file not found: {input_file}")

    current_peak_db = get_peak_level(input_file)
    needed_gain = target_peak_db - current_peak_db

    print(f"Normalizing {input_file} to {target_peak_db} dB (need {needed_gain:+.1f} dB)")

    if abs(needed_gain) < 0.5:
        print("  Already at target level, skipping.")
        return

    return boost_audio(input_file, needed_gain, output_file)


def normalize_directory(directory, target_peak_db=-1.0, extensions=('.ogg', '.wav', '.mp3')):
    """
    Normalize all audio files in a directory to a target peak level.

    Args:
        directory: Path to directory containing audio files
        target_peak_db: Target peak level (default -1.0 dB)
        extensions: Tuple of file extensions to process
    """
    if not os.path.isdir(directory):
        raise NotADirectoryError(f"Not a directory: {directory}")

    # Find all audio files
    audio_files = []
    for root, dirs, files in os.walk(directory):
        for filename in files:
            if filename.lower().endswith(extensions):
                audio_files.append(os.path.join(root, filename))

    if not audio_files:
        print(f"No audio files found in {directory}")
        return

    print(f"Found {len(audio_files)} audio files in {directory}")
    print(f"Target peak level: {target_peak_db} dB")
    print("-" * 50)

    results = []
    for filepath in sorted(audio_files):
        try:
            result = normalize_audio(filepath, target_peak_db=target_peak_db)
            if result:
                results.append((filepath, result))
        except Exception as e:
            print(f"  ERROR: {e}")
        print()

    # Summary
    print("=" * 50)
    print("SUMMARY")
    print("=" * 50)
    boosted = [r for r in results if r[1]['applied_gain_db'] > 0.5]
    reduced = [r for r in results if r[1]['applied_gain_db'] < -0.5]
    unchanged = len(audio_files) - len(boosted) - len(reduced)

    print(f"  Files boosted:   {len(boosted)}")
    print(f"  Files reduced:   {len(reduced)}")
    print(f"  Files unchanged: {unchanged}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        print("\nExamples:")
        print("  Boost by 6 dB (overwrite original):")
        print("    python boost_audio_volume.py sound-effects/player-death.ogg 6")
        print("")
        print("  Boost by 6 dB (save to new file):")
        print("    python boost_audio_volume.py sound-effects/player-death.ogg 6 boosted.ogg")
        print("")
        print("  Normalize single file to -1 dB peak:")
        print("    python boost_audio_volume.py sound-effects/player-death.ogg normalize")
        print("")
        print("  Normalize all audio files in a directory:")
        print("    python boost_audio_volume.py sound-effects/ normalize")
        sys.exit(1)

    input_path = sys.argv[1]

    if sys.argv[2].lower() == "normalize":
        if os.path.isdir(input_path):
            # Normalize entire directory
            normalize_directory(input_path, target_peak_db=-1.0)
        else:
            # Normalize single file
            output_file = sys.argv[3] if len(sys.argv) > 3 else None
            normalize_audio(input_path, target_peak_db=-1.0, output_file=output_file)
    else:
        gain_db = float(sys.argv[2])
        output_file = sys.argv[3] if len(sys.argv) > 3 else None
        boost_audio(input_path, gain_db, output_file)


if __name__ == "__main__":
    main()
