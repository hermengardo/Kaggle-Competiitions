
const ORBIT_WARS_STEP_DURATION = 550; // 2200 / 4 — RTS plays best at 4x default speed

export function getOrbitWarsStepRenderTime(
  gameStep: any,
  replayMode: any,
  speedModifier: number
): number {
  return ORBIT_WARS_STEP_DURATION * (1 / speedModifier);
}
