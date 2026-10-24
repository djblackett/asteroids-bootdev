/** Seconds on the fixed simulation clock; audio callbacks never control gameplay. */
export const BOSS_CINEMATIC = {
  musicFade: 0.8,
  alarmStart: 0.8,
  alarmFade: 0.4,
  entranceStart: 1.1,
  // Keep the original descent independent of the earlier combat/audio handoff.
  descentEnd: 14,
  combatStart: 9,
  skipAfter: 5,
  barFill: 0.75,
  failure: 0.65,
  detonation: 2.6,
  victory: 3.3,
  aftermath: 6.5,
} as const;
