# Sources: issue #192, the 3D trajectory joined from Earth to the Moon

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Curtis, H. D., Orbital Mechanics for Engineering Students, chapters 3 and 5 (algorithm 3.3, the universal Kepler equation; algorithm 5.2, Lambert's problem) | `core/lambert.ts`: Stumpff functions, the universal-variable propagation and Lambert solver. Written from the published method; the tests check them against the circular-orbit and Hohmann formulas, not against the book's worked examples | https://www.sciencedirect.com/book/9780081021330/orbital-mechanics-for-engineering-students | Book; method only, no text or code copied |
| Lambert's problem (Wikipedia) | A check of the problem's statement: the orbit between two points in a given time | https://en.wikipedia.org/wiki/Lambert%27s_problem | CC BY-SA 4.0 |
| Hyperbolic trajectory (Wikipedia) | The asymptote's true anomaly, acos(−1/e), used in `arrivalOrbit` to place the LOI point from the arrival direction | https://en.wikipedia.org/wiki/Hyperbolic_trajectory | CC BY-SA 4.0 |
| Tidal locking (Wikipedia) | The Moon keeps one face to Earth: the model's Moon-fixed frame has longitude 0 towards Earth (librations ignored) | https://en.wikipedia.org/wiki/Tidal_locking | CC BY-SA 4.0 |
| Bennett, F. V. (1970), Apollo lunar descent and ascent trajectories, NASA TM X-58040 | Named for the approach phase from the high gate and the low gate at about 500 ft (150 m) where the vertical landing begins; not read for this issue, as for T34 and issue #181 | https://ntrs.nasa.gov/citations/19700024568 | NASA, public domain |
| three.js (already a project dependency) | Vectors and quaternions in the scene | https://threejs.org/ | MIT |

Model choices, not from a source: the lunar orbit's plane is the one through the site at touchdown that holds the arrival direction (so LOI needs no plane change), crossed heading south; the wait in lunar orbit stays within half a lap of Apollo 11's; the Moon's axis is taken upright to the transfer's plane (really about 1.5° from the ecliptic's normal and 6.7° from its orbit's).

Also a model choice: the departure plane is the one inclined by the pad's latitude (a launch due east) to Earth's equator that holds the arrival; of the two, the one nearer the Moon's orbit plane. Earth's pole is taken as ICRF's z (J2000; precession since then, about 0.3°, ignored). The approach's 30 m/s sink limit and half-thrust braking are the model's choices.
