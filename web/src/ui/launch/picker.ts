// The launch-site picker (T34): a pop-up window with a satellite globe of Earth, the launch pads
// in use marked on it, and the same pads as a list. "Proceed" on the mission card opens it.
// Click a marker or a list entry to choose; drag to turn the globe. Theme: ui/theme.css (T19).
import './picker.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PADS, padById, type Pad } from '../../core/pads';
import { themeColor } from '../plotTheme';
import { coordText } from '../mission/format';
import { disposeScene, earthDirection, makeEarth, prefersReducedMotion, themeLength } from './earth';

export type PickerOptions = {
  padId: string;
  confirmLabel: string;
  onConfirm: (padId: string) => void;
};

const MARKER_R = 0.018;   // in Earth radii
const VIEW_DISTANCE = 3.2;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** Opens the picker. It removes itself, and frees its WebGL context, when it closes. */
export function openPadPicker(options: PickerOptions): void {
  const dialog = make('dialog', 'card lp-dialog');
  dialog.setAttribute('aria-labelledby', 'lp-title');
  const head = make('div', 'lp-head');
  const title = make('h2', '', 'Choose a launch site');
  title.id = 'lp-title';
  const close = make('button', 'btn ms-small', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  head.append(title, close);

  const globe = make('div', 'lp-globe');
  const hint = make('p', 'lp-hint muted', 'Drag to turn the globe · click a marker to choose');
  const globeBox = make('div', 'lp-globe-box');
  globeBox.append(globe, hint);

  const list = make('div', 'lp-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Launch pads');
  const chosen = make('div', 'lp-chosen');
  chosen.setAttribute('aria-live', 'polite');

  const cancel = make('button', 'btn', 'Cancel');
  cancel.type = 'button';
  const confirm = make('button', 'btn btn-primary', options.confirmLabel);
  confirm.type = 'button';
  const foot = make('div', 'lp-foot');
  const buttons = make('div', 'lp-buttons');
  buttons.append(cancel, confirm);
  foot.append(chosen, buttons);

  const body = make('div', 'lp-body');
  body.append(globeBox, list);
  dialog.append(head, body, foot);
  document.body.append(dialog);

  // --- The globe ---------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  globe.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const earth = makeEarth(1, false);
  scene.add(earth);
  const markerGeometry = new THREE.SphereGeometry(MARKER_R, 16, 12);
  const idle = new THREE.Color(themeColor('--warn'));
  const active = new THREE.Color(themeColor('--accent'));
  const markers = new Map<string, THREE.Mesh>();
  for (const p of PADS) {
    const m = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: idle }));
    m.position.copy(earthDirection(p.lat, p.lon).multiplyScalar(1 + MARKER_R * 0.3));
    m.userData.padId = p.id;
    markers.set(p.id, m);
    scene.add(m);
  }
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 6;
  controls.rotateSpeed = 0.5;

  // --- Choosing ----------------------------------------------------------------------------
  let current: Pad = padById(options.padId);
  let glide: { from: THREE.Vector3; to: THREE.Vector3; startMs: number } | null = null;
  const items = new Map<string, HTMLButtonElement>();

  for (const p of PADS) {
    const b = make('button', 'lp-item');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.append(make('b', '', p.name), make('span', 'lp-sub', `${p.pad} · ${p.country}`));
    b.addEventListener('click', () => choose(p.id, true));
    items.set(p.id, b);
    list.append(b);
  }

  const lookAt = (p: Pad, animate: boolean): void => {
    const to = earthDirection(p.lat, p.lon).multiplyScalar(camera.position.length() || VIEW_DISTANCE);
    if (!animate || prefersReducedMotion()) {
      camera.position.copy(to);
      glide = null;
    } else {
      glide = { from: camera.position.clone(), to, startMs: performance.now() };
    }
  };

  function choose(id: string, turn: boolean): void {
    current = padById(id);
    for (const [pid, m] of markers) {
      const on = pid === current.id;
      (m.material as THREE.MeshBasicMaterial).color.copy(on ? active : idle);
      m.scale.setScalar(on ? 1.8 : 1);
    }
    for (const [pid, b] of items) b.setAttribute('aria-selected', String(pid === current.id));
    chosen.replaceChildren(make('span', 'ms-k', 'Launch pad'), make('b', '', `${current.name} · ${current.pad}`),
      make('span', 'ms-coord muted', `${current.country} · ${coordText(current.lat, current.lon)}`));
    if (turn) {
      lookAt(current, true);
      items.get(current.id)?.scrollIntoView({ block: 'nearest' });
    }
  }

  // A click on a marker (not the end of a drag).
  const raycaster = new THREE.Raycaster();
  let downAt: [number, number] | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; glide = null; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > themeLength('--space-1')) return;
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    // Markers are small: also take the nearest one within a few marker sizes of the ray.
    const hit = raycaster.intersectObjects([earth, ...markers.values()])[0];
    let best: string | null = hit?.object.userData.padId ?? null;
    if (!best && hit) {
      let bestD = MARKER_R * 4;
      for (const [pid, m] of markers) {
        const d = m.position.distanceTo(hit.point);
        if (d < bestD) { bestD = d; best = pid; }
      }
    }
    if (best) choose(best, false);
  });

  // --- Size and frames ---------------------------------------------------------------------
  const resize = (): void => {
    const w = globe.clientWidth;
    const h = globe.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const sizer = new ResizeObserver(resize);
  sizer.observe(globe);

  let frame = 0;
  const draw = (now: number): void => {
    if (glide) {
      const f = Math.min(1, (now - glide.startMs) / 700);
      const e = f * f * (3 - 2 * f);
      const len = glide.from.length() + (glide.to.length() - glide.from.length()) * e;
      camera.position.copy(glide.from.clone().normalize().lerp(glide.to.clone().normalize(), e).normalize().multiplyScalar(len));
      if (f >= 1) glide = null;
    }
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  };

  // --- Open and close ----------------------------------------------------------------------
  const shut = (): void => dialog.close();
  close.addEventListener('click', shut);
  cancel.addEventListener('click', shut);
  confirm.addEventListener('click', () => {
    const id = current.id;
    shut();
    options.onConfirm(id);
  });
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame);
    sizer.disconnect();
    controls.dispose();
    disposeScene(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    dialog.remove();
  });

  dialog.showModal();
  camera.position.copy(earthDirection(current.lat, current.lon).multiplyScalar(VIEW_DISTANCE));
  choose(current.id, false);
  items.get(current.id)?.scrollIntoView({ block: 'nearest' });
  resize();
  frame = requestAnimationFrame(draw);
  confirm.focus();
}
