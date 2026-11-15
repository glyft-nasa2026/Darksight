# Sources: issue #192, the 3D trajectory joined from Earth to the Moon

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Curtis, H. D., Orbital Mechanics for Engineering Students, chapters 3 and 5 (algorithm 3.3, the universal Kepler equation; algorithm 5.2, Lambert's problem) | `core/lambert.ts`: Stumpff functions, the universal-variable propagation and Lambert solver. Written from the published method; the tests check them against the circular-orbit and Hohmann formulas, not against the book's worked examples | https://www.sciencedirect.com/book/9780081021330/orbital-mechanics-for-engineering-students | Book; method only, no text or code copied |
| Lambert's problem (Wikipedia) | A check of the problem's statement: the orbit between two points in a given time | https://en.wikipedia.org/wiki/Lambert%27s_problem | CC BY-SA 4.0 |
| Hyperbolic trajectory (Wikipedia) | The asymptote's true anomaly, acos(−1/e), used in `arrivalOrbit` to place the LOI point from the arrival direction | https://en.wikipedia.org/wiki/Hyperbolic_trajectory | CC BY-SA 4.0 |
| Tidal locking (Wikipedia) | The Moon keeps one face to Earth: the model's Moon-fixed frame has longitude 0 towards Earth (librations ignored) | https://en.wikipedia.org/wiki/Tidal_locking | CC BY-SA 4.0 |
| three.js (already a project dependency) | Vectors and quaternions in the scene | https://threejs.org/ | MIT |

Model choices, not from a source: the lunar orbit's plane is the one through the site at touchdown that holds the arrival direction (so LOI needs no plane change), crossed heading south; the wait in lunar orbit stays within half a lap of Apollo 11's; the Moon's axis is taken upright to the transfer's plane (really about 1.5° from the ecliptic's normal and 6.7° from its orbit's).
