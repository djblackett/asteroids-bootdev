import pygame
import random
import sys
import time

# Check if running in web browser (pygbag/emscripten)
IS_WEB = sys.platform == "emscripten"

# Only import numpy if not in web environment
if not IS_WEB:
    import numpy as np

# Sound cache - will be loaded after pygame.init()
_sounds_loaded = False
_shoot_sounds = []
_explosion_sounds = {}
_laser_sound = None
_boost_sound = None

# AUDIO OPTIMIZATION: Dedicated channels for high-priority sounds
# This prevents important sounds (like shooting) from being cut off
# when many sounds play simultaneously
_shoot_channels = []  # Reserved channels for shoot sounds
_next_shoot_channel = 0  # Round-robin index for shoot channels

# Music position tracking for pitch shifting
_music_start_time = 0
_music_offset = 0  # Offset in seconds from when music started

def add_reverb(sound, delay_ms=50, decay=0.3, num_echoes=3):
    """
    Add a simple reverb effect to a sound by creating delayed echoes.

    Args:
        sound: pygame.mixer.Sound object
        delay_ms: Delay between echoes in milliseconds
        decay: How much each echo is reduced in volume (0.0 to 1.0)
        num_echoes: Number of echo repetitions
    """
    # Get the sound array
    sound_array = pygame.sndarray.array(sound)

    # Calculate delay in samples
    sample_rate = pygame.mixer.get_init()[0]
    delay_samples = int((delay_ms / 1000.0) * sample_rate)

    # Create output array with extra space for echoes
    total_length = len(sound_array) + (delay_samples * num_echoes)
    output = np.zeros((total_length, sound_array.shape[1] if len(sound_array.shape) > 1 else 1), dtype=sound_array.dtype)

    # Handle mono/stereo
    if len(sound_array.shape) == 1:
        sound_array = sound_array.reshape(-1, 1)

    # Add original sound
    output[:len(sound_array)] = sound_array

    # Add echoes with decay
    for i in range(1, num_echoes + 1):
        echo_start = delay_samples * i
        echo_volume = decay ** i
        echo_end = min(echo_start + len(sound_array), total_length)
        echo_length = echo_end - echo_start

        output[echo_start:echo_end] += (sound_array[:echo_length] * echo_volume).astype(sound_array.dtype)

    # Normalize to prevent clipping
    max_val = np.abs(output).max()
    if max_val > 0:
        output = (output / max_val * 32767 * 0.9).astype(np.int16)

    # Convert back to sound
    return pygame.sndarray.make_sound(output)

def change_pitch(sound, pitch_factor):
    """
    Change the pitch of a sound by adjusting playback speed.

    Args:
        sound: pygame.mixer.Sound object
        pitch_factor: Multiplier for pitch (1.0 = original, >1.0 = higher, <1.0 = lower)
    """
    # Get sound array
    sound_array = pygame.sndarray.array(sound)

    # Handle mono/stereo
    is_stereo = len(sound_array.shape) > 1

    # Resample the array
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

def debug_print(*args, **kwargs):
    """Print only on desktop, not on web."""
    if not IS_WEB:
        print(*args, **kwargs)


def init_sounds():
    """Load and process sounds after pygame is initialized. Call this explicitly from main."""
    global _sounds_loaded, _shoot_sounds, _explosion_sounds, _laser_sound, _boost_sound

    if _sounds_loaded:
        return

    debug_print("Loading sounds...")

    if IS_WEB:
        # Use pre-processed audio files for web - full quality without runtime processing
        debug_print("Web mode: loading pre-processed sounds...")

        try:
            # Try to load pre-processed shooting sound variations
            _shoot_sounds = [
                pygame.mixer.Sound("./sound-effects/processed/shoot_low.wav"),
                pygame.mixer.Sound("./sound-effects/processed/shoot_mid.wav"),
                pygame.mixer.Sound("./sound-effects/processed/shoot_high.wav"),
            ]

            # Load pre-processed explosion sounds
            _explosion_sounds['large'] = pygame.mixer.Sound("./sound-effects/processed/explosion_large.wav")
            _explosion_sounds['medium'] = pygame.mixer.Sound("./sound-effects/processed/explosion_medium.wav")
            _explosion_sounds['small'] = pygame.mixer.Sound("./sound-effects/processed/explosion_small.wav")
            debug_print("Loaded pre-processed sounds successfully!")
        except Exception as e:
            # Fallback to original sounds if processed files not found
            debug_print(f"Could not load processed sounds ({e}), using originals...")
            original_shoot = pygame.mixer.Sound("./sound-effects/shoot_01.wav")
            _shoot_sounds = [original_shoot]

            original_explosion = pygame.mixer.Sound("./sound-effects/big-explosion.wav")
            _explosion_sounds['large'] = original_explosion
            _explosion_sounds['medium'] = original_explosion
            _explosion_sounds['small'] = original_explosion

    else:
        # Full audio processing for desktop
        debug_print("Desktop mode: loading sounds with processing...")

        # Load and process shooting sounds
        original_shoot = pygame.mixer.Sound("./sound-effects/shoot_01.wav")
        shoot_reverb = add_reverb(original_shoot, delay_ms=40, decay=0.25, num_echoes=4)

        # Pre-generate 3 pitch variations
        _shoot_sounds = [
            change_pitch(shoot_reverb, 0.96),
            change_pitch(shoot_reverb, 1.0),
            change_pitch(shoot_reverb, 1.04),
        ]

        # Load and process explosion sounds
        original_explosion = pygame.mixer.Sound("./sound-effects/big-explosion.wav")

        _explosion_sounds['large'] = change_pitch(original_explosion, 0.4)   # Very deep boom
        _explosion_sounds['medium'] = change_pitch(original_explosion, 1.0)  # Original
        _explosion_sounds['small'] = change_pitch(original_explosion, 2.2)   # Very high crack

    # Load laser beam sound (no processing needed)
    _laser_sound = pygame.mixer.Sound("./sound-effects/laser.ogg")
    _laser_sound.set_volume(0.7)  # Set volume to 70% so it's not too loud

    # Load boost sound (no processing needed)
    _boost_sound = pygame.mixer.Sound("./sound-effects/boost-woosh.ogg")
    _boost_sound.set_volume(0.6)  # Set volume to 60%

    # AUDIO OPTIMIZATION: Reserve dedicated channels for shoot sounds (desktop only)
    # Channels 0-5 are reserved for shooting (most frequent sound)
    # This ensures shoot sounds always have a channel available and play immediately
    # Note: Skip on web - pygbag has limited Channel support
    global _shoot_channels
    if not IS_WEB:
        _shoot_channels = [pygame.mixer.Channel(i) for i in range(6)]
    else:
        _shoot_channels = []  # Web uses default .play() behavior

    _sounds_loaded = True
    debug_print("Sounds loaded!")

def _ensure_sounds_loaded():
    """Check if sounds are loaded, and load them if not."""
    if not _sounds_loaded:
        init_sounds()

def play_shoot_sound():
    """
    Play the shooting sound effect with reverb and pitch variation.

    AUDIO OPTIMIZATION: Uses dedicated channels with round-robin allocation
    to ensure shoot sounds always play immediately without delay or cutoff.
    """
    global _next_shoot_channel
    _ensure_sounds_loaded()

    # Randomly select one of the pre-generated varied sounds
    sound = random.choice(_shoot_sounds)

    # Use dedicated channel with round-robin to prevent channel conflicts
    # This ensures the sound plays immediately on a guaranteed-available channel
    if _shoot_channels:
        channel = _shoot_channels[_next_shoot_channel]
        channel.play(sound)
        _next_shoot_channel = (_next_shoot_channel + 1) % len(_shoot_channels)
    else:
        # Fallback to default behavior if channels not initialized
        sound.play()

def play_laser_sound():
    """Play the laser beam sound effect."""
    _ensure_sounds_loaded()

    if _laser_sound:
        _laser_sound.play()

def play_boost_sound():
    """Play the boost sound effect."""
    _ensure_sounds_loaded()

    if _boost_sound:
        _boost_sound.play()

def play_explosion_sound(asteroid_radius):
    """
    Play the explosion sound effect when an asteroid is destroyed.
    Uses pre-generated pitch-shifted versions based on asteroid size.

    AUDIO OPTIMIZATION: Limits concurrent explosion sounds to prevent audio mudding
    when many asteroids explode simultaneously (e.g., chain reactions).

    Args:
        asteroid_radius: The radius of the asteroid being destroyed
    """
    _ensure_sounds_loaded()

    # Select the appropriate pre-generated sound based on asteroid size
    # Asteroid sizes: Large = 60, Medium = 40, Small = 20
    if asteroid_radius >= 50:
        sound = _explosion_sounds['large']
    elif asteroid_radius >= 30:
        sound = _explosion_sounds['medium']
    else:
        sound = _explosion_sounds['small']

    # AUDIO OPTIMIZATION: Limit concurrent explosion sounds (desktop only)
    # If this exact sound is already playing on 3+ channels, skip it
    # This prevents audio mudding during chain explosions while still
    # allowing different explosion types to play
    # Note: Skip channel checking on web - pygbag has limited Channel/get_num_channels support
    if not IS_WEB:
        playing_count = 0
        try:
            for i in range(pygame.mixer.get_num_channels()):
                channel = pygame.mixer.Channel(i)
                if channel.get_sound() == sound and channel.get_busy():
                    playing_count += 1
                    if playing_count >= 3:
                        return  # Skip playing, already have enough of this sound
        except Exception:
            pass  # If channel checking fails, just play the sound

    sound.play()

def start_background_music():
    """
    Start playing the background music on loop.
    Uses pygame.mixer.music for background music (separate from sound effects).
    """
    global _music_start_time, _music_offset
    pygame.mixer.music.load("./music/retro-bgmusic.ogg")
    pygame.mixer.music.set_volume(0.5)  # Set volume to 50% so it doesn't overpower sound effects
    pygame.mixer.music.play(-1)  # -1 means loop indefinitely
    _music_start_time = time.time()
    _music_offset = 0

def stop_background_music():
    """Stop the background music."""
    pygame.mixer.music.stop()

def is_music_playing():
    """Check if music is currently playing."""
    return pygame.mixer.music.get_busy()

def pause_music():
    """Pause the background music."""
    pygame.mixer.music.pause()

def unpause_music():
    """Unpause the background music."""
    pygame.mixer.music.unpause()

def set_music_speed(speed_multiplier):
    """
    Pitch shift the background music up by adjusting mixer frequency.
    Preserves playback position so music continues from where it was.

    Args:
        speed_multiplier: Pitch shift factor (1.0 = normal, >1.0 = higher pitch and faster)
    """
    global _music_start_time, _music_offset, _sounds_loaded

    # Skip music speed changes in web mode (mixer reinit causes issues)
    if IS_WEB:
        return

    if speed_multiplier != 1.0:
        # Get current mixer to determine current speed
        try:
            current_freq, current_size, current_channels = pygame.mixer.get_init()
            if current_freq:
                current_speed = current_freq / 22050.0
            else:
                current_speed = 1.0
        except:
            current_speed = 1.0
            current_size = -16
            current_channels = 2

        # Calculate how far into the music we are
        # Time since last change, multiplied by current speed
        time_elapsed_realtime = time.time() - _music_start_time
        time_elapsed_in_music = time_elapsed_realtime * current_speed + _music_offset

        # Calculate new frequency for pitch shift
        # 4 semitones up = 2^(4/12) ≈ 1.26 multiplier
        new_freq = int(22050 * speed_multiplier)

        # Reinitialize mixer with new frequency (this also pitch shifts)
        pygame.mixer.quit()
        pygame.mixer.init(frequency=new_freq, size=current_size, channels=current_channels, buffer=512)
        pygame.mixer.set_num_channels(32)  # Restore channel count after reinit

        # Reload music and start from calculated position
        pygame.mixer.music.load("./music/retro-bgmusic.ogg")
        pygame.mixer.music.set_volume(0.5)

        # Resume from where we were (divide by new speed to get the "start" position)
        # The start parameter works at the FILE's speed, so we need to adjust
        start_pos = max(0, time_elapsed_in_music / speed_multiplier)
        pygame.mixer.music.play(-1, start=start_pos)

        # Update tracking with the actual music position
        _music_start_time = time.time()
        _music_offset = start_pos

        # Reload sound effects since we changed the mixer
        _sounds_loaded = False
        init_sounds()

def reset_music_speed():
    """Reset music to normal playback speed and pitch."""
    global _music_start_time, _music_offset, _sounds_loaded

    # Skip music speed changes in web mode (mixer reinit causes issues)
    if IS_WEB:
        return

    # Get current mixer to determine speed multiplier
    try:
        current_freq, current_size, current_channels = pygame.mixer.get_init()
        if current_freq:
            speed_multiplier = current_freq / 22050.0
        else:
            speed_multiplier = 1.0
    except:
        speed_multiplier = 1.0

    # Calculate how far into the music we are
    # Time since speed change, multiplied by speed (faster = more music played)
    time_elapsed_realtime = time.time() - _music_start_time
    time_elapsed_in_music = time_elapsed_realtime * speed_multiplier + _music_offset

    # Reset mixer to normal frequency
    pygame.mixer.quit()
    pygame.mixer.init(frequency=22050, size=-16, channels=2, buffer=512)
    pygame.mixer.set_num_channels(32)  # Restore channel count after reinit

    # Reload music and continue from position
    pygame.mixer.music.load("./music/retro-bgmusic.ogg")
    pygame.mixer.music.set_volume(0.5)

    # Make sure start position is valid (positive)
    start_pos = max(0, time_elapsed_in_music)
    pygame.mixer.music.play(-1, start=start_pos)

    # Update tracking
    _music_start_time = time.time()
    _music_offset = start_pos

    # Reload sound effects since we reset the mixer
    _sounds_loaded = False
    init_sounds()
