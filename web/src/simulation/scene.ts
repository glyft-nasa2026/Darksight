// The 3D picture on the launch simulation page (T34). It draws only positions that
// core/mission.ts's missionAt returns, in the plane of the transfer: Earth at the origin, the
// Moon on its circle, the lunar orbit round the Moon with the landing site on it. Bodies are to
// scale; the craft, the pad and the site are markers. Earth's turn is a picture: it is set so
// the pad lies under the craft at launch. The Moon is drawn north up, with a latitude and
// longitude grid, and the landing site placed from core (moonFixedInPlane), so each site lands
// where it is on the Moon. The scene illustrates; every number is on the page.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  approachSeconds, EARTH_SPIN, lunarFrameInEarthPlane, MU_EARTH, missionAt, moonFixedInPlane, R_EARTH, R_MOON, type MissionState, type OkPlan, type StepId,
} from '../core/mission';
import type { Pad } from '../core/pads';
import { disposeScene, earthDirection, makeEarth, prefersReducedMotion, themeLength } from '../ui/launch/earth';
import { themeColor } from '../ui/plotTheme';
import { alignFrames } from '../core/sky';
import type { Vec3 } from '../core/ephemeris';
import { makeStarField } from '../scene/stars';
import { lambert, propagate } from '../core/lambert';

export type Scale = 'near' | 'earth' | 'moon' | 'descent';

/** The scale that suits a step; the arrival at the Moon (inside its sphere of influence) is shown at the Moon. */
export function scaleFor(id: StepId, st?: MissionState): Scale {
  if (id === 'launch' || id === 'parking' || id === 'tli') return 'near';
  if (id === 'coast') return st?.approach ? 'moon' : 'earth';
  if (id === 'powered-descent' || id === 'touchdown') return 'descent';
  return 'moon';
}

const KM = 1 / 1000;   // scene units per km
/** A point of a mission plane (km, y up) in the scene: the plane is the scene's x-z floor. */
const P = ([x, y]: [number, number]): THREE.Vector3 => new THREE.Vector3(x * KM, 0, -y * KM);
/** The same with the plane's normal (z) as the scene's up. */
const P3 = ([x, y, z]: [number, number, number]): THREE.Vector3 => new THREE.Vector3(x * KM, z * KM, -y * KM);

// A change of scale glides: a short one in about 1.5 s, Earth orbit out to the Earth-Moon
// view (20 times wider) in about 3.2 s. The pan keeps pace with the zoom (see draw), so the
// place being left and the place being reached both stay in view.
const GLIDE_BASE_MS = 1200;
const GLIDE_PER_E_FOLD_MS = 650;
const GLIDE_MAX_MS = 3600;
/** 0..1 eased with zero speed and zero acceleration at both ends (smootherstep). */
const ease = (f: number): number => f * f * f * (f * (6 * f - 15) + 10);
const isMoonScale = (s: Scale): boolean => s === 'moon' || s === 'descent';
const VIEW_DIRECTION: Record<Scale, THREE.Vector3> = {
  near: new THREE.Vector3(0.25, 0.75, 1).normalize(),
  earth: new THREE.Vector3(0, 1, 0.55).normalize(),
  moon: new THREE.Vector3(0.25, 0.2, 1).normalize(),   // replaced per plan: along the orbit's normal
  descent: new THREE.Vector3(0, 0, 1),   // replaced per plan: from the side of the site
};

type Track = { times: number[]; flown: THREE.Line };

function line(points: THREE.Vector3[], color: string, opacity: number): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

/** missionAt at n + 1 even times, keeping the point pick() returns. */
function sample(plan: OkPlan, from: number, to: number, n: number, pick: (s: MissionState) => [number, number] | null) {
  const times: number[] = [];
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    const p = pick(missionAt(plan, t));
    if (p) { times.push(t); points.push(P(p)); }
  }
  return { times, points };
}

export type MissionScene = {
  /** burning: the engine is firing (the ascent, the powered descent, or an instant burn's moment). */
  update: (st: MissionState, scale: Scale, burning: boolean) => void;
  dispose: () => void;
};

export function createScene(
  container: HTMLElement, plan: OkPlan, pad: Pad, site: { lat: number; lon: number }, siteColor: string,
  sky: { toMoon: Vec3; pole: Vec3 } | null = null,
): MissionScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(themeColor('--bg'));
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1e-4, 5000);
  scene.add(camera);
  scene.add(new THREE.AmbientLight(themeColor('--lit'), 0.6));
  const headlight = new THREE.DirectionalLight(themeColor('--lit'), 2.4);
  headlight.position.set(0.4, 0.6, 1);
  camera.add(headlight);   // a light from the viewer, not the Sun: the page computes no Sun here

  const step = (id: StepId) => plan.steps.find((s) => s.id === id)!;
  const launch = plan.launchMs;
  const tli = step('tli').startMs;
  const loi = step('loi').startMs;
  const pdi = step('powered-descent').startMs;
  const td = plan.touchdownMs;

  // The real sky (issue #80). The floor of the scene is the plane of the transfer; it is laid on
  // the Moon's real orbit plane at touchdown (core/sky.ts moonOrbitIcrf), with the Moon where it
  // really is then. Without the table's Earth vectors there are no stars.
  const stars = makeStarField();
  if (sky) {
    const moonAt = P(missionAt(plan, td).earthPlane.moon).normalize();
    stars.turn(alignFrames(sky.toMoon, sky.pole, [moonAt.x, moonAt.y, moonAt.z], [0, 1, 0]));
    scene.add(stars.object);
  }

  // Earth, turned so the pad is under the craft at launch.
  const earth = makeEarth(R_EARTH * KM, true);
  scene.add(earth);
  const padDir = earthDirection(pad.lat, pad.lon);
  const launchDir = P(missionAt(plan, launch).earthPlane.craft).normalize();
  const tilt = new THREE.Quaternion().setFromUnitVectors(padDir, launchDir);
  const spin = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const padMark = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * KM * 0.012, 12, 8),
    new THREE.MeshBasicMaterial({ color: themeColor('--warn') }));
  padMark.position.copy(padDir.clone().multiplyScalar(R_EARTH * KM * 1.002));
  earth.add(padMark);

  // The Moon, carried along its circle. Inside `moon` everything is in missionAt's lunar-orbit
  // frame (P, P3); the group is turned as core says that frame sits in the transfer's
  // (lunarFrameInEarthPlane, issue #192): the Moon's north up, its near side towards Earth, and
  // the orbit in the plane the arrival leads into, so the arrival carries on from the transfer.
  const moon = new THREE.Group();
  scene.add(moon);
  const at = (t: number, lat: number, lon: number): THREE.Vector3 => P3(moonFixedInPlane(plan, t, lat, lon));
  const axis = ([x, y, z]: [number, number, number]): THREE.Vector3 => new THREE.Vector3(x, z, -y);   // P3, unscaled
  const [lx, ly, lz] = lunarFrameInEarthPlane(plan);
  // The group's axes are P3 of the lunar frame's: x, then z (its normal) up, then -y.
  moon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axis(lx), axis(lz), axis(ly).negate()));
  // The Moon views look along the orbit's normal, from the side the Earth view is on.
  const orbitNormal = axis(lz);
  if (orbitNormal.dot(VIEW_DIRECTION.earth) < 0) orbitNormal.negate();
  const up = new THREE.Vector3(0, 1, 0);
  const moonView = orbitNormal.clone().addScaledVector(up, 0.2)
    .addScaledVector(new THREE.Vector3().crossVectors(up, orbitNormal), 0.25).normalize();
  // The body itself turns with the Moon: its grid follows the Moon-fixed frame from core.
  const moonBody = new THREE.Group();
  moon.add(moonBody);
  moonBody.add(new THREE.Mesh(new THREE.SphereGeometry(R_MOON * KM, 96, 64),
    new THREE.MeshLambertMaterial({ color: themeColor('--terrain-hi') })));
  const grid: THREE.Vector3[] = [];
  const gridR = R_MOON * KM * 1.0015;
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 3) grid.push(earthDirection(lat, lon).multiplyScalar(gridR), earthDirection(lat + 3, lon).multiplyScalar(gridR));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 3) grid.push(earthDirection(lat, lon).multiplyScalar(gridR), earthDirection(lat, lon + 3).multiplyScalar(gridR));
  }
  moonBody.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid),
    new THREE.LineBasicMaterial({ color: themeColor('--terrain-lo'), transparent: true, opacity: 0.6 })));
  const turnBody = (t: number): void => {
    const xb = at(t, 0, 0).normalize();
    const yb = at(t, 90, 0).normalize();
    const zb = at(t, 0, 90).normalize().negate();   // earthDirection puts 90° E on -z
    moonBody.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xb, yb, zb));
  };
  const siteMark = new THREE.Mesh(new THREE.SphereGeometry(R_MOON * KM * 0.006, 12, 8),
    new THREE.MeshBasicMaterial({ color: themeColor(siteColor) }));
  moon.add(siteMark);
  const placeSite = (t: number): void => { siteMark.position.copy(at(t, site.lat, site.lon).multiplyScalar(1.0005)); };
  placeSite(td);
  // The descent is watched from beside the site, looking along the orbit's normal.
  const siteOut = at(td, site.lat, site.lon).normalize().applyQuaternion(moon.quaternion);
  const descentView = siteOut.clone().multiplyScalar(0.45).add(orbitNormal).normalize();

  // Markers that stay visible when the bodies are a few pixels across: round dots.
  const disc = document.createElement('canvas');
  disc.width = disc.height = 64;
  const ctx = disc.getContext('2d');
  if (ctx) {
    ctx.fillStyle = themeColor('--text');
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, 2 * Math.PI);
    ctx.fill();
  }
  const discTexture = new THREE.CanvasTexture(disc);
  const dot = (color: string, size: string, onTop: boolean): THREE.Points => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const m = new THREE.PointsMaterial({
      color: themeColor(color), size: themeLength(size), sizeAttenuation: false, depthTest: !onTop,
      map: discTexture, alphaTest: 0.5, transparent: true,
    });
    const p = new THREE.Points(g, m);
    p.renderOrder = onTop ? 2 : 0;
    return p;
  };
  scene.add(dot('--earth', '--space-2', false));
  moon.add(dot('--terrain-hi', '--space-2', false));
  const siteDot = dot(siteColor, '--space-2', false);
  siteMark.add(siteDot);
  const craft = dot('--ok', '--space-3', true);
  scene.add(craft);

  // The paths: faint ahead, full where flown. At the Moon each orbit the craft is put on has its
  // own colour, so the changes show: the arrival hyperbola, the 100 km orbit after LOI, the
  // descent orbit after DOI, and the powered descent.
  const tracks: Track[] = [];
  const addTrack = (parent: THREE.Object3D, s: { times: number[]; points: THREE.Vector3[] }, color: string): THREE.Line[] => {
    if (s.points.length < 2) return [];
    const c = themeColor(color);
    const before = line(s.points, c, 0.5);
    const flown = line(s.points, c, 1);
    flown.geometry.setDrawRange(0, 0);
    flown.renderOrder = 1;
    parent.add(before, flown);
    tracks.push({ times: s.times, flown });
    return [before, flown];
  };
  const doi = step('doi').startMs;
  // Where the craft is drawn (issue #192). From the Moon's sphere of influence on, it is on its
  // Moon-centred path, carried with the Moon. Before that, after TLI, it is on the one orbit
  // round Earth that leaves the TLI point and reaches the arrival hyperbola's first point in the
  // coast's time (core/lambert.ts): TLI sets the course, and the coast is a single smooth conic,
  // tilted out of the plane as far as the arrival needs. Worked out for each plan.
  // The first whole millisecond inside the sphere of influence: at loi - approachSeconds itself,
  // rounding can leave missionAt just outside it, with no Moon-centred position yet.
  let arrive = Math.ceil(loi - approachSeconds(plan) * 1000);
  while (!missionAt(plan, arrive).moonPlane && arrive < loi) arrive++;
  const atMoon = (st: MissionState): THREE.Vector3 =>
    P(st.earthPlane.moon).add(P(st.moonPlane!).applyQuaternion(moon.quaternion));
  const onCoast = (t: number): THREE.Vector3 => P(missionAt(plan, t).earthPlane.craft);
  // In km, in the scene's axes: the transfer plane is the floor, so its normal is +y.
  const tliKm = onCoast(tli).divideScalar(KM).toArray();
  const aim = lambert(tliKm, atMoon(missionAt(plan, arrive)).divideScalar(KM).toArray(), (arrive - tli) / 1000, MU_EARTH, [0, 1, 0]);
  const inScene = (st: MissionState): THREE.Vector3 => {
    if (st.moonPlane) return atMoon(st);
    if (!aim || st.tMs <= tli) return P(st.earthPlane.craft);
    return new THREE.Vector3(...propagate(tliKm, aim.v1, (st.tMs - tli) / 1000, MU_EARTH)).multiplyScalar(KM);
  };
  // The arrival hyperbola's times, densely near the periapsis, where it bends.
  const approachTimes: number[] = [];
  for (let i = 0; i <= 400; i++) approachTimes.push(Math.min(loi - 1, loi - (loi - arrive) * (1 - i / 400) ** 3));
  // The transfer from the pad to LOI as one line, in the scene: launch, the parking orbit, the
  // bent coast and, inside the sphere of influence, the arrival as it is seen from Earth.
  const transfer = { times: [] as number[], points: [] as THREE.Vector3[] };
  const toTliTimes = Array.from({ length: 501 }, (_, i) => launch + ((tli - launch) * i) / 500);
  // Densest just after TLI, where the craft is fastest and the near view shows the departure.
  const coastTimes = Array.from({ length: 800 }, (_, i) => tli + (arrive - tli) * ((i + 1) / 800) ** 2);
  for (const t of [...toTliTimes, ...coastTimes, ...approachTimes.slice(1)]) {
    transfer.times.push(t);
    transfer.points.push(inScene(missionAt(plan, t)));
  }
  const earthTrack = addTrack(scene, transfer, '--accent');
  const approach = { times: [] as number[], points: [] as THREE.Vector3[] };
  for (const t of approachTimes) {
    const m = missionAt(plan, t).moonPlane;
    if (m) { approach.times.push(t); approach.points.push(P(m)); }
  }
  const approachTrack = addTrack(moon, approach, '--muted');
  addTrack(moon, sample(plan, loi, doi, 500, (s) => s.moonPlane), '--accent');
  addTrack(moon, sample(plan, doi, pdi, 400, (s) => s.moonPlane), '--warn');
  addTrack(moon, sample(plan, pdi, td, 400, (s) => s.moonPlane), '--ok');
  // The Moon's own circle, faint.
  const moonCircle: THREE.Vector3[] = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * 2 * Math.PI;
    moonCircle.push(P([plan.orbit.earthMoonKm * Math.cos(a), plan.orbit.earthMoonKm * Math.sin(a)]));
  }
  const moonPath = line(moonCircle, themeColor('--border'), 1);
  scene.add(moonPath);

  // --- The burns that change the orbit at the Moon, marked where they happen -----------------------
  const burns: { el: HTMLSpanElement; local: THREE.Vector3; scales: Scale[]; arriving: boolean }[] = [];
  const burnMark = (t: number, text: string, scales: Scale[], arriving = false): void => {
    const local = P(missionAt(plan, t).moonPlane!);
    const mark = dot('--warn', '--space-2', true);
    mark.position.copy(local);
    moon.add(mark);
    const el = document.createElement('span');
    el.className = 'sim-label sim-label-burn';
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');
    container.append(el);
    burns.push({ el, local, scales, arriving });
  };
  burnMark(loi, 'LOI burn', ['moon'], true);   // the one shown while arriving: where the craft aims
  burnMark(doi, 'DOI burn', ['moon']);
  burnMark(pdi, 'Powered descent starts', ['moon', 'descent']);

  // --- Camera: follows the body of the scale; glides (or cuts) when the scale changes -----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.rotateSpeed = 0.6;
  let shown: Scale | null = null;
  let glide: {
    from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; startMs: number; ms: number;
    fromMoon: number;   // the Moon frame's weight for the craft when the glide began
  } | null = null;
  // The craft's weight on its Moon-centred path (1) against the Earth-frame transfer (0): it
  // changes over the glide, so the craft dot slides instead of jumping between the two.
  let moonWeight = 0;
  const lastTarget = new THREE.Vector3();

  const distanceFor = (scale: Scale): number => {
    // A tall view (a phone) is narrow across: step back so the width still fits.
    const narrow = Math.max(1, 1.5 / camera.aspect);
    if (scale === 'near') return R_EARTH * KM * 4.5 * narrow;
    if (scale === 'earth') return plan.orbit.earthMoonKm * KM * 1.45 * narrow;
    if (scale === 'moon') {
      // Arriving: far enough back to see the hyperbola come in, closing in as it nears.
      const r = last?.st.approach && last.st.moonPlane ? Math.hypot(...last.st.moonPlane) : 0;
      return Math.max(R_MOON * KM * 4.2, r * KM * 2) * narrow;
    }
    return Math.max(plan.orbit.descentRangeKm, 60) * KM * 1.6 * narrow;
  };
  const targetFor = (scale: Scale, st: MissionState): THREE.Vector3 => {
    if (scale === 'near') return new THREE.Vector3();
    if (scale === 'earth') return P(st.earthPlane.moon).multiplyScalar(0.5);
    if (scale === 'moon') {
      // Arriving: aim halfway between the Moon and the craft, so both stay in view.
      if (st.approach && st.moonPlane) return moon.position.clone().add(P(st.moonPlane).applyQuaternion(moon.quaternion).multiplyScalar(0.5));
      return moon.position.clone();
    }
    return moon.position.clone().add(siteMark.position.clone().applyQuaternion(moon.quaternion));
  };

  const resize = (): void => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const sizer = new ResizeObserver(resize);
  sizer.observe(container);
  resize();

  // --- Labels: HTML over the picture, placed where the bodies and the craft are on screen -------
  const label = (text: string, kind: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = `sim-label sim-label-${kind}`;
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');   // the page's text says the same
    container.append(el);
    return el;
  };
  const labels = {
    craft: label('Spacecraft', 'craft'),
    earth: label('Earth', 'body'),
    moon: label('Moon', 'body'),
    site: label('Landing site', 'site'),
  };
  labels.site.style.setProperty('--sim-site', `var(${siteColor})`);
  const ndc = new THREE.Vector3();
  const put = (el: HTMLElement, world: THREE.Vector3, show = true): void => {
    ndc.copy(world).project(camera);
    const inView = show && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    el.hidden = !inView;
    if (!inView) return;
    el.style.left = `${((ndc.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - ndc.y) / 2) * 100}%`;
  };
  const placeLabels = (scale: Scale): void => {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    put(labels.earth, up.clone().multiplyScalar(R_EARTH * KM));
    put(labels.moon, moon.position.clone().addScaledVector(up, R_MOON * KM), scale !== 'descent');
    put(labels.site, moon.position.clone().add(siteMark.position.clone().applyQuaternion(moon.quaternion)),
      scale === 'moon' || scale === 'descent');
    put(labels.craft, craft.position);
    for (const b of burns) {
      const show = b.scales.includes(scale) && (b.arriving || !last?.st.approach);
      put(b.el, moon.position.clone().add(b.local.clone().applyQuaternion(moon.quaternion)), show);
    }
  };

  let last: { st: MissionState; scale: Scale; burning: boolean } | null = null;
  // The craft is on the one joined path at every scale (inScene). The Earth-scale lines fade
  // out toward the Moon's scales, where the Moon-centred tracks show the same path up close.
  // The arrival hyperbola does the opposite: it is drawn round the Moon and moves with it, so at
  // Earth's scales it would hang off where the Moon is now, not where the craft meets it. There
  // the transfer line already shows the arrival.
  const fades = [
    ...[...earthTrack, moonPath].map((l) => ({ l, atMoon: false })),
    ...approachTrack.map((l) => ({ l, atMoon: true })),
  ];
  for (const { l } of fades) l.userData.opacity = (l.material as THREE.LineBasicMaterial).opacity;
  const placeCraft = (st: MissionState | undefined = last?.st): void => {
    if (!st) return;
    craft.position.copy(inScene(st));
    for (const { l, atMoon: shownAtMoon } of fades) {
      const m = l.material as THREE.LineBasicMaterial;
      m.transparent = true;
      m.opacity = l.userData.opacity * (shownAtMoon ? moonWeight : 1 - moonWeight);
      l.visible = m.opacity > 0.01;
    }
  };
  let settling = false;
  let frame = 0;
  const draw = (now: number): void => {
    frame = requestAnimationFrame(draw);
    if (!last) return;
    const { st, scale } = last;
    const target = targetFor(scale, st);
    let offset = camera.position.clone().sub(lastTarget);
    if (scale !== shown) {
      const view = scale === 'descent' ? descentView : scale === 'moon' ? moonView : VIEW_DIRECTION[scale];
      const to = view.clone().multiplyScalar(distanceFor(scale));
      if (shown === null || prefersReducedMotion()) {
        offset = to;
        glide = null;
        moonWeight = isMoonScale(scale) ? 1 : 0;
      } else {
        const fold = Math.abs(Math.log(to.length() / offset.length()));
        const ms = Math.min(GLIDE_MAX_MS, GLIDE_BASE_MS + GLIDE_PER_E_FOLD_MS * fold);
        glide = { from: offset.clone(), to, fromTarget: lastTarget.clone(), startMs: now, ms, fromMoon: moonWeight };
      }
      shown = scale;
    }
    let aim = target;
    if (glide) {
      const f = Math.min(1, (now - glide.startMs) / glide.ms);
      const e = ease(f);
      const d0 = glide.from.length();
      const d1 = glide.to.length();
      const len = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e);
      offset = glide.from.clone().normalize().lerp(glide.to.clone().normalize(), e).normalize().multiplyScalar(len);
      // Pan in step with the zoom: the aim has moved the same share of the way as the view's
      // width has changed. Zooming out, the start stays in view while the view widens; zooming
      // in, the aim reaches the new place early, while the view is still wide enough to show it.
      const u = Math.abs(d1 - d0) < 1e-9 ? e : (len - d0) / (d1 - d0);
      aim = glide.fromTarget.clone().lerp(target, u);
      moonWeight = glide.fromMoon + ((isMoonScale(scale) ? 1 : 0) - glide.fromMoon) * e;
      if (f >= 1) glide = null;
    } else {
      moonWeight = isMoonScale(scale) ? 1 : 0;
    }
    placeCraft();
    if (!glide && scale === 'moon' && (st.approach || settling)) {
      // Ease the distance toward the one that fits the arrival, then leave the zoom to the user.
      const want = distanceFor('moon');
      const len = offset.length();
      const next = Math.exp(Math.log(len) + (Math.log(want) - Math.log(len)) * 0.08);
      offset.setLength(next);
      settling = st.approach || Math.abs(Math.log(next / want)) > 0.01;
    }
    controls.target.copy(aim);
    camera.position.copy(aim).add(offset);
    lastTarget.copy(aim);
    controls.minDistance = distanceFor(scale) * 0.05;
    controls.maxDistance = distanceFor(scale) * 6;
    controls.update();
    renderer.render(scene, camera);
    placeLabels(scale);
  };
  frame = requestAnimationFrame(draw);

  return {
    update: (st, scale, burning) => {
      moon.position.copy(P(st.earthPlane.moon));
      spin.setFromAxisAngle(yAxis, EARTH_SPIN * st.elapsedS);
      earth.quaternion.copy(tilt).multiply(spin);
      turnBody(st.tMs);
      placeSite(st.tMs);
      if (!glide) placeCraft(st);
      // Firing: the craft shows as a larger --warn dot, and its label says so.
      const cm = craft.material as THREE.PointsMaterial;
      cm.color.set(themeColor(burning ? '--warn' : '--ok'));
      cm.size = themeLength(burning ? '--space-4' : '--space-3');
      labels.craft.textContent = burning ? 'Spacecraft · engine firing' : 'Spacecraft';
      labels.craft.classList.toggle('sim-label-firing', burning);
      for (const tr of tracks) {
        let n = 0;
        while (n < tr.times.length && tr.times[n] <= st.tMs) n++;
        tr.flown.geometry.setDrawRange(0, n);
      }
      last = { st, scale, burning };
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      sizer.disconnect();
      controls.dispose();
      stars.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
      for (const el of Object.values(labels)) el.remove();
      for (const b of burns) b.el.remove();
    },
  };
}
