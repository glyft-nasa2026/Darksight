// The 3D picture on the launch simulation page (T34). It draws only positions that
// core/mission.ts's missionAt returns, in the plane of the transfer: Earth at the origin, the
// Moon on its circle, the lunar orbit round the Moon with the landing site on it. Bodies are to
// scale; the craft, the pad and the site are markers. Earth's turn is a picture: it is set so
// the pad lies under the craft at launch. The scene illustrates; every number is on the page.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EARTH_SPIN, missionAt, R_EARTH, R_MOON, type MissionState, type OkPlan, type StepId } from '../core/mission';
import type { Pad } from '../core/pads';
import { disposeScene, earthDirection, makeEarth, prefersReducedMotion, themeLength } from '../ui/launch/earth';
import { themeColor } from '../ui/plotTheme';

export type Scale = 'near' | 'earth' | 'moon' | 'descent';

/** The scale that suits a step. */
export function scaleFor(id: StepId): Scale {
  if (id === 'launch' || id === 'parking' || id === 'tli') return 'near';
  if (id === 'coast') return 'earth';
  if (id === 'powered-descent' || id === 'touchdown') return 'descent';
  return 'moon';
}

const KM = 1 / 1000;   // scene units per km
/** A point of a mission plane (km, y up) in the scene: the plane is the scene's x-z floor. */
const P = ([x, y]: [number, number]): THREE.Vector3 => new THREE.Vector3(x * KM, 0, -y * KM);

const GLIDE_MS = 1400;
const VIEW_DIRECTION: Record<Scale, THREE.Vector3> = {
  near: new THREE.Vector3(0.25, 0.75, 1).normalize(),
  earth: new THREE.Vector3(0, 1, 0.55).normalize(),
  moon: new THREE.Vector3(0.3, 0.8, 1).normalize(),
  descent: new THREE.Vector3(0.15, 1, -0.6).normalize(),
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
  update: (st: MissionState, scale: Scale) => void;
  dispose: () => void;
};

export function createScene(container: HTMLElement, plan: OkPlan, pad: Pad, siteColor: string): MissionScene {
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

  // The Moon, with the landing site on it, carried along its circle.
  const moon = new THREE.Group();
  scene.add(moon);
  const moonBall = new THREE.Mesh(new THREE.SphereGeometry(R_MOON * KM, 96, 64),
    new THREE.MeshLambertMaterial({ color: themeColor('--terrain-hi') }));
  moon.add(moonBall);
  const siteMark = new THREE.Mesh(new THREE.SphereGeometry(R_MOON * KM * 0.006, 12, 8),
    new THREE.MeshBasicMaterial({ color: themeColor(siteColor) }));
  siteMark.position.copy(P([0, R_MOON]));
  moon.add(siteMark);

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
  const craft = dot('--accent', '--space-3', true);
  scene.add(craft);

  // The paths: dim ahead, bright where flown.
  const ahead = themeColor('--muted');
  const flownColor = themeColor('--accent');
  const tracks: Track[] = [];
  const addTrack = (parent: THREE.Object3D, s: { times: number[]; points: THREE.Vector3[] }): void => {
    if (s.points.length < 2) return;
    parent.add(line(s.points, ahead, 0.45));
    const flown = line(s.points, flownColor, 1);
    flown.geometry.setDrawRange(0, 0);
    flown.renderOrder = 1;
    parent.add(flown);
    tracks.push({ times: s.times, flown });
  };
  const toTli = sample(plan, launch, tli, 500, (s) => s.earthPlane.craft);
  const coast = sample(plan, tli, loi, 700, (s) => s.earthPlane.craft);
  addTrack(scene, { times: [...toTli.times, ...coast.times], points: [...toTli.points, ...coast.points] });
  const orbit = sample(plan, loi, pdi, 700, (s) => s.moonPlane);
  const descent = sample(plan, pdi, td, 400, (s) => s.moonPlane);
  addTrack(moon, { times: [...orbit.times, ...descent.times], points: [...orbit.points, ...descent.points] });
  // The Moon's own circle, faint.
  const moonCircle: THREE.Vector3[] = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * 2 * Math.PI;
    moonCircle.push(P([plan.orbit.earthMoonKm * Math.cos(a), plan.orbit.earthMoonKm * Math.sin(a)]));
  }
  scene.add(line(moonCircle, themeColor('--border'), 1));

  // --- Camera: follows the body of the scale; glides (or cuts) when the scale changes -----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.rotateSpeed = 0.6;
  let shown: Scale | null = null;
  let glide: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; startMs: number } | null = null;
  const lastTarget = new THREE.Vector3();

  const distanceFor = (scale: Scale): number => {
    // A tall view (a phone) is narrow across: step back so the width still fits.
    const narrow = Math.max(1, 1.5 / camera.aspect);
    if (scale === 'near') return R_EARTH * KM * 4.5 * narrow;
    if (scale === 'earth') return plan.orbit.earthMoonKm * KM * 1.45 * narrow;
    if (scale === 'moon') return R_MOON * KM * 4.2 * narrow;
    return Math.max(plan.orbit.descentRangeKm, 60) * KM * 1.6 * narrow;
  };
  const targetFor = (scale: Scale, st: MissionState): THREE.Vector3 => {
    if (scale === 'near') return new THREE.Vector3();
    if (scale === 'earth') return P(st.earthPlane.moon).multiplyScalar(0.5);
    if (scale === 'moon') return moon.position.clone();
    return moon.position.clone().add(siteMark.position);
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

  let last: { st: MissionState; scale: Scale } | null = null;
  let frame = 0;
  const draw = (now: number): void => {
    frame = requestAnimationFrame(draw);
    if (!last) return;
    const { st, scale } = last;
    const target = targetFor(scale, st);
    let offset = camera.position.clone().sub(lastTarget);
    if (scale !== shown) {
      const to = VIEW_DIRECTION[scale].clone().multiplyScalar(distanceFor(scale));
      if (shown === null || prefersReducedMotion()) {
        offset = to;
        glide = null;
      } else {
        glide = { from: offset.clone(), to, fromTarget: lastTarget.clone(), startMs: now };
      }
      shown = scale;
    }
    let at = target;
    if (glide) {
      const f = Math.min(1, (now - glide.startMs) / GLIDE_MS);
      const e = f * f * (3 - 2 * f);
      const len = Math.exp(Math.log(glide.from.length()) + (Math.log(glide.to.length()) - Math.log(glide.from.length())) * e);
      offset = glide.from.clone().normalize().lerp(glide.to.clone().normalize(), e).normalize().multiplyScalar(len);
      at = glide.fromTarget.clone().lerp(target, e);
      if (f >= 1) glide = null;
    }
    controls.target.copy(at);
    camera.position.copy(at).add(offset);
    lastTarget.copy(at);
    controls.minDistance = distanceFor(scale) * 0.05;
    controls.maxDistance = distanceFor(scale) * 6;
    controls.update();
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(draw);

  return {
    update: (st, scale) => {
      moon.position.copy(P(st.earthPlane.moon));
      spin.setFromAxisAngle(yAxis, EARTH_SPIN * st.elapsedS);
      earth.quaternion.copy(tilt).multiply(spin);
      craft.position.copy(st.moonPlane ? moon.position.clone().add(P(st.moonPlane)) : P(st.earthPlane.craft));
      for (const tr of tracks) {
        let n = 0;
        while (n < tr.times.length && tr.times[n] <= st.tMs) n++;
        tr.flown.geometry.setDrawRange(0, n);
      }
      last = { st, scale };
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      sizer.disconnect();
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
