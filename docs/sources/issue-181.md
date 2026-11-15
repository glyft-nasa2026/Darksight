# Sources: issue #181, a more realistic mission simulation

| What | Used for | Link | Licence or terms |
|---|---|---|---|
| Delta-v budget (Wikipedia), "Launch/landing" | Launch to low Earth orbit needs the orbital speed "but also typically 1.5–2 km/s for atmospheric drag and gravity drag": `ASCENT_LOSSES_KMS = 1.75`, the middle | https://en.wikipedia.org/wiki/Delta-v_budget | CC BY-SA 4.0 |
| NASA SP-4029, Apollo 11 timeline | Powered descent ignition 102:33:05.01 and landing 102:45:39.9 GET: 12 min 34.9 s, the descent test's reference (already a T34 source) | https://www.nasa.gov/wp-content/uploads/static/history/SP-4029/Apollo_11i_Timeline.htm | NASA, public domain |
| Descent propulsion system (Wikipedia) | The lunar module's descent engine for the Apollo test case: 45.04 kN maximum (the page's body text), Isp 311 s | https://en.wikipedia.org/wiki/Descent_propulsion_system | CC BY-SA 4.0 |
| Apollo Lunar Module (Wikipedia) | The test lander's mass: 15,100 kg, just under the page's 15,200 kg standard launch mass. The mass at powered descent itself was not found in a source, so the test allows 20 % | https://en.wikipedia.org/wiki/Apollo_Lunar_Module | CC BY-SA 4.0 |
| Bennett, F. V. (1970), Apollo lunar descent and ascent trajectories, NASA TM X-58040 | Named for the braking, approach and landing phases and the high gate (already a T34 source). Not read for this issue, as for T34 | https://ntrs.nasa.gov/citations/19700024568 | NASA, public domain |

The steering constants (2 km high gate, 33 s altitude loop, 40 s landing rate, 4 s speed loops) are the model's choices, tuned so the Apollo case lands within the test's 20 %; they are not taken from Apollo's guidance equations.
