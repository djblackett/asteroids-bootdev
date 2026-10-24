/** Seconds on the fixed simulation clock; audio callbacks never control gameplay. */
export const BOSS_CINEMATIC = {
  musicFade: 0.8,
  alarmStart: 0.8,
  // ffprobe: 20.013500 s; decoded MP3 audio ~20.0135 s. Keep the complete recording.
  alarmDuration: 20.0135,
  entranceStart: 1.1,
  combatStart: 20.85,
  skipAfter: 5,
  barFill: 0.75,
  failure: 0.65,
  detonation: 2.6,
  victory: 3.3,
  aftermath: 6.5,
} as const;
