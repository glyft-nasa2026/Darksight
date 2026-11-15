// Where the transfer meets the arrival at the Moon in the 3D scene (issue #192).
//
// core/mission.ts gives the craft two paths. In the Earth plane, the translunar coast is a
// Kepler ellipse that runs into the Moon's centre at LOI. Round the Moon, from its sphere of
// influence on, the arrival hyperbola lies in the lunar orbit's plane, with its periapsis at
// the LOI point. The scene draws both. They don't meet: at the sphere of influence they are
// tens of thousands of km apart, and they head in different directions.
//
// The scene bends the coast so that it does meet the hyperbola. The bend is zero at TLI and
// grows smoothly over the coast. At the sphere of influence the bent coast reaches the
// hyperbola's first point, moving at the hyperbola's velocity there, so the line has no gap and
// no corner. The bend is worked out again for each plan, from that plan's own two paths, so
// every landing site and date gets its own join.
//
// This is only how the picture is drawn. The numbers on the page still come from missionAt.

export type V3 = [number, number, number];

/**
 * The offset added to the coast at tMs, in the units of `gap`: a cubic Hermite blend from
 * zero (no offset and no change in it) at fromMs to `gap`, changing at `gapRatePerS` per
 * second, at toMs. Zero before fromMs, `gap` from toMs on.
 */
export function coastBend(tMs: number, fromMs: number, toMs: number, gap: V3, gapRatePerS: V3): V3 {
  if (!(toMs > fromMs) || tMs <= fromMs) return [0, 0, 0];
  if (tMs >= toMs) return [gap[0], gap[1], gap[2]];
  const spanS = (toMs - fromMs) / 1000;
  const s = (tMs - fromMs) / (toMs - fromMs);
  const reach = s * s * (3 - 2 * s);         // 0 to 1, flat at the start
  const turn = s * s * (s - 1) * spanS;      // 0 at both ends; its rate is 1 at the end
  return [0, 1, 2].map((i) => reach * gap[i] + turn * gapRatePerS[i]) as V3;
}
