# Sources: issue #192, the 3D trajectory joined from Earth to the Moon

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Cubic Hermite spline (Wikipedia) | The basis functions in `coastBend`: h01 = 3s² − 2s³ to reach the gap, h11 = s³ − s² to match the hyperbola's velocity at the end | https://en.wikipedia.org/wiki/Cubic_Hermite_spline | CC BY-SA 4.0 |
| three.js (already a project dependency) | Vectors and quaternions in the scene | https://threejs.org/ | MIT |

No dataset or paper is used. The bend is how the picture is drawn, not a trajectory: it only joins the model's two paths (the Earth-frame coast and the Moon-centred arrival hyperbola from `core/mission.ts`). A physically consistent arrival would change the model itself and is not part of this issue.
