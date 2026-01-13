#!/usr/bin/env python3
"""
Audio preprocessing script for web compatibility.
Generates all processed audio variations and saves them as separate files.
"""

import pygame
import numpy as np
import os

def add_reverb(sound, delay_ms=50, decay=0.3, num_echoes=3):
    """Add reverb effect to a sound."""
    sound_array = pygame.sndarray.array(sound)
    sample_rate = pygame.mixer.get_init()[0]
    delay_samples = int((delay_ms / 1000.0) * sample_rate)

    total_length = len(sound_array) + (delay_samples * num_echoes)
    output = np.zeros((total_length, sound_array.shape[1] if len(sound_array.shape) > 1 else 1), dtype=sound_array.dtype)

    if len(sound_array.shape) == 1:
        sound_array = sound_array.reshape(-1, 1)

    output[:len(sound_array)] = sound_array

    for i in range(1, num_echoes + 1):
        echo_start = delay_samples * i
        echo_volume = decay ** i
        echo_end = min(echo_start + len(sound_array), total_length)
        echo_length = echo_end - echo_start
        output[echo_start:echo_end] += (sound_array[:echo_length] * echo_volume).astype(sound_array.dtype)

    max_val = np.abs(output).max()
    if max_val > 0:
        output = (output / max_val * 32767 * 0.9).astype(np.int16)

    return pygame.sndarray.make_sound(output)

def change_pitch(sound, pitch_factor):
    """Change the pitch of a sound."""
    sound_array = pygame.sndarray.array(sound)
    is_stereo = len(sound_array.shape) > 1

    original_length = len(sound_array)
    new_length = int(original_length / pitch_factor)

    if is_stereo:
        new_array = np.zeros((new_length, sound_array.shape[1]), dtype=sound_array.dtype)
        for channel in range(sound_array.shape[1]):
            indices = np.linspace(0, original_length - 1, new_length)
            new_array[:, channel] = np.interp(indices, np.arange(original_length), sound_array[:, channel])
    else:
        indices = np.linspace(0, original_length - 1, new_length)
        new_array = np.interp(indices, np.arange(original_length), sound_array)

    return pygame.sndarray.make_sound(new_array.astype(sound_array.dtype))

def sound_to_array_and_save(sound, filepath):
    """Save a pygame Sound object to a WAV file using wave module."""
    import wave
    import struct

    sound_array = pygame.sndarray.array(sound)
    sample_rate = pygame.mixer.get_init()[0]

    # Open WAV file for writing
    with wave.open(filepath, 'w') as wav_file:
        # Determine number of channels
        if len(sound_array.shape) == 1:
            n_channels = 1
            frames = sound_array
        else:
            n_channels = sound_array.shape[1]
            # Interleave stereo channels
            frames = sound_array.flatten()

        # Set WAV parameters
        wav_file.setnchannels(n_channels)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)

        # Convert to bytes and write
        frames_bytes = struct.pack(f'{len(frames)}h', *frames)
        wav_file.writeframes(frames_bytes)

def main():
    print("Audio Preprocessing Tool")
    print("=" * 50)

    # Initialize pygame
    pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=128)
    pygame.init()

    output_dir = "./sound-effects/processed"
    os.makedirs(output_dir, exist_ok=True)

    print(f"\nOutput directory: {output_dir}")

    # Process shooting sounds
    print("\nProcessing shooting sounds...")
    original_shoot = pygame.mixer.Sound("./sound-effects/shoot_01.wav")
    shoot_reverb = add_reverb(original_shoot, delay_ms=40, decay=0.25, num_echoes=4)

    shoot_low = change_pitch(shoot_reverb, 0.96)
    shoot_mid = change_pitch(shoot_reverb, 1.0)
    shoot_high = change_pitch(shoot_reverb, 1.04)

    # Save as WAV files (OGG encoding requires additional libraries)
    sound_to_array_and_save(shoot_low, os.path.join(output_dir, "shoot_low.wav"))
    sound_to_array_and_save(shoot_mid, os.path.join(output_dir, "shoot_mid.wav"))
    sound_to_array_and_save(shoot_high, os.path.join(output_dir, "shoot_high.wav"))
    print("  [OK] Created: shoot_low.wav, shoot_mid.wav, shoot_high.wav")

    # Process explosion sounds
    print("\nProcessing explosion sounds...")
    original_explosion = pygame.mixer.Sound("./sound-effects/big-explosion.wav")

    explosion_large = change_pitch(original_explosion, 0.4)
    explosion_medium = change_pitch(original_explosion, 1.0)
    explosion_small = change_pitch(original_explosion, 2.2)

    sound_to_array_and_save(explosion_large, os.path.join(output_dir, "explosion_large.wav"))
    sound_to_array_and_save(explosion_medium, os.path.join(output_dir, "explosion_medium.wav"))
    sound_to_array_and_save(explosion_small, os.path.join(output_dir, "explosion_small.wav"))
    print("  [OK] Created: explosion_large.wav, explosion_medium.wav, explosion_small.wav")

    print("\n" + "=" * 50)
    print("[OK] Audio preprocessing complete!")
    print(f"[OK] 6 processed audio files saved to {output_dir}")
    print("\nYou can now use these pre-processed files for web deployment.")

if __name__ == "__main__":
    main()
