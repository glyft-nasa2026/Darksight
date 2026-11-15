# Sources: issue #80, a star map behind the 3D views

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Yale Bright Star Catalogue, 5th revised ed. (Hoffleit and Warren 1991), VizieR V/50 | Star positions (J2000), V magnitude and B-V colour (`stars.bin`) | https://vizier.cfa.harvard.edu/ftp/cats/V/50/ (`catalog.gz`, byte layout in `ReadMe`) | CDS/VizieR data, free for scientific and educational use |
| Archinal et al. 2011, "Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2009", Celest. Mech. Dyn. Astr. 109, 101-135, table 2 (the Moon) | `moonFromIcrf` in `core/sky.ts` | https://doi.org/10.1007/s10569-010-9320-4 | Paper; formulas only |
| IAU 1976 precession (Lieske et al. 1977) and IAU 1982 Greenwich mean sidereal time (Aoki et al. 1982), as given in the Explanatory Supplement to the Astronomical Almanac | `earthFromIcrf` in `core/sky.ts` | https://doi.org/10.1007/BF00141236 (precession) | Formulas only |
| Skyfield 1.55, `PlanetaryConstants` with the DE440 Moon kernels (`docs/sources/T01.md`) and `skyfield.framelib.itrs` | The fixture `sky.json` that `sky.test.ts` checks against | https://rhodesmill.org/skyfield/planetary.html | MIT |
| three.js 0.187 (`ShaderMaterial`, `Points`, additive blending) | Drawing the stars | https://threejs.org/docs/ | MIT |
