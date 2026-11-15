import {
  AmbientLight, Box3, CanvasTexture, Color, DirectionalLight, Group, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, ObjectSpaceNormalMap, PCFShadowMap, PerspectiveCamera, Raycaster,
  Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
  type Material,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Dem } from '../core/dem';
import { MOON_RADIUS_KM, type Sample, type Site } from '../core/types';
import {
  getState, samplesFor, select, selected, setLiveSite, setMode, subscribe, tableGap, type AppState,
} from '../state';
import { themeColor } from '../ui/plotTheme';
import { noRowText } from '../ui/tableGap';
import { moonFromIcrf, multiply, type Mat3 } from '../core/sky';
import { makeStarField } from './stars';
import { hiddenByMoon, poleLines, POLES, poleStub, viewportFraction } from './poles';
import { mount as mountMap, unmount as unmountMap, viewOf } from '../map';
import { abovePose, blendPose, fadeDone, startFade, stepFade, type Fade } from './transition';
import { carryOffset, gridSite, moonCentre, moonDirection, siteNorth, sitePosition, siteUp, sphereSite } from './coordinates';
import {
  detailBounds, drawnDemHeight, edgeHeight, globeGeometry, NORTH_RELIEF, northGeometry, recolorTerrain, restretchTerrain, setTerrainHole,
  terrainGeometry, type GridBounds,
} from './terrain';
import { colorTexture, GLOBE_RELIEF, globeNormalNear, normalTexture, sharedGlobe, sharedNorth, type GlobeHeights } from './globe';
import {
  groundAngle, loadTileIndex, loadWindow, PATCH_MOVE_DEG, patchGeometry, patchLiftAt, patchWindow, stretchPatch,
  viewGround, type TileIndex,
} from './patch';
import { discAlpha, glareAlpha, sunDiscScale, sunTexture } from './sun';
import { mount as mountLayers } from '../ui/layers';
import './scene.css';

const mounts = new WeakMap<HTMLElement, () => void>();
const RAD = Math.PI / 180;
/** Sets only the drawn size of the Earth sprite. No number shown to the user depends on it. */
const EARTH_RADIUS_KM = 6371;
/** The Earth sprite is drawn this far from the site, scaled to its true apparent size. */
const EARTH_DRAWN_KM = 20_000;
/** The Sun sprite is drawn a little beyond the Earth's, so the Earth passes in front of it. */
const SUN_DRAWN_KM = EARTH_DRAWN_KM * 1.05;
/**
 * The starting view of a site off the south-pole height map takes in about this much ground each
 * way, in km: most of the level-of-detail patch round it (patch.ts, about 180 km each way).
 */
const SITE_SPAN_KM = 150;
/** moonDirection (coordinates.ts) as a rotation: Moon-fixed to the render frame. */
const MOON_TO_SCENE: Mat3 = [[0, 1, 0], [0, 0, -1], [-1, 0, 0]];

type PinData = { site: Site; scenarioId?: string; label: string; base: Vector3; up: Vector3; scale: number };

/** Stylised illustration; no geographic dataset or numerical result is generated here. */
function earthTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = themeColor('--earth');
  ctx.beginPath(); ctx.arc(64, 64, 61, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = themeColor('--terrain-hi');
  for (const points of [
    [[24, 26], [50, 16], [61, 31], [48, 42], [55, 56], [35, 66], [19, 48]],
    [[44, 65], [62, 69], [66, 86], [48, 111], [40, 91]],
    [[79, 24], [102, 36], [109, 60], [96, 68], [81, 57], [72, 42]],
  ]) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A theme length in CSS pixels, so the pin size comes from theme.css rather than from here. */
function themeLength(host: HTMLElement, name: string): number {
  const probe = document.createElement('div');
  probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; probe.style.width = `var(${name})`;
  host.append(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px;
}

export function mount(el: HTMLElement): void {
  mounts.get(el)?.();
  el.innerHTML = `
    <div class="scene-toolbar">
      <h2>Moon explorer</h2>
      <div class="scene-modes" role="group" aria-label="Map view">
        <button class="btn" type="button" data-mode="2d">2D map</button>
        <button class="btn" type="button" data-mode="3d">3D orbit</button>
      </div>
      <button class="btn scene-reset" type="button">Centre selected site</button>
      <div class="scene-modes scene-drag" role="group" aria-label="What a drag turns in 3D">
        <button class="btn" type="button" data-drag="site" title="Drag to orbit the selected site, never below its horizon">Orbit site</button>
        <button class="btn" type="button" data-drag="globe" title="Drag to turn the whole Moon like a ball, north up">Turn Moon</button>
      </div>
      <label class="scene-stretch">Vertical stretch
        <input type="range" min="1" max="5" step="1" value="1" aria-label="Vertical stretch">
        <output>1×</output>
      </label>
    </div>
    <div class="scene-viewport"><p class="scene-message muted" role="status">Loading Sun and Earth table…</p><section id="nudge" aria-label="Nudge"></section><section class="scene-layers" aria-label="Map layers" data-map-corner="tr"></section></div>
    <p class="scene-help muted">Click to pick a site · drag to pan · scroll to zoom</p>
    <p class="scene-caption muted">Lighting illustrates the terrain; use the readout for visibility.</p>`;
  const viewport = el.querySelector<HTMLDivElement>('.scene-viewport')!;
  const message = el.querySelector<HTMLParagraphElement>('.scene-message')!;
  const help = el.querySelector<HTMLParagraphElement>('.scene-help')!;
  const caption = el.querySelector<HTMLParagraphElement>('.scene-caption')!;
  const slider = el.querySelector<HTMLInputElement>('input')!;
  const output = el.querySelector<HTMLOutputElement>('output')!;
  const reset = el.querySelector<HTMLButtonElement>('.scene-reset')!;
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  const dragButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-drag]')];
  const dragGroup = el.querySelector<HTMLDivElement>('.scene-drag')!;
  // The 2D map is a flat canvas of its own (web/src/map/, T31), shown in place of the 3D canvas in
  // 2D mode. It needs no WebGL, so it works even where the 3D scene can't.
  const mapHost = document.createElement('div');
  viewport.prepend(mapHost); mountMap(mapHost);
  // T14 map layers: icon switches floating over the map in its top right corner, which the nudge
  // panel then leaves free (data-map-corner); the map draws the layers.
  mountLayers(el.querySelector<HTMLElement>('.scene-layers')!);
  const centreMap = (): void => { mapHost.dispatchEvent(new Event('map:centre')); };
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ antialias: true }); }
  catch {
    // No 3D: keep the flat map, switch to it, and say why the 3D button is off.
    const only2d = buttons.find((b) => b.dataset.mode === '2d')!;
    for (const b of buttons) {
      const is2d = b === only2d;
      b.disabled = !is2d; b.classList.toggle('btn-primary', is2d); b.setAttribute('aria-pressed', String(is2d));
    }
    slider.disabled = true;
    dragGroup.hidden = true;
    help.textContent = 'The 3D view needs WebGL, which this browser has switched off · Click to pick a site · drag to pan · scroll to zoom';
    caption.textContent = 'Lighting is illustrative; use the readout for visibility';
    message.hidden = true;
    reset.addEventListener('click', centreMap);
    if (getState().mode !== '2d') setMode('2d');
    mounts.set(el, () => { reset.removeEventListener('click', centreMap); unmountMap(mapHost); mounts.delete(el); });
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'scene-canvas'; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive Moon terrain. Click to select a site; use the site list for keyboard selection.');
  viewport.prepend(canvas);

  let frame = 0, disposed = false, lost = false, framed = false;
  let mode: AppState['mode'] = getState().mode;
  // T29: how much of the 3D view shows, 0 (the map only) to 1 (the 3D view only), and the fade
  // between the two after a change of mode. The map lies over the 3D canvas and fades over it.
  let shown = mode === '3d' ? 1 : 0;
  let fade: Fade | null = null;
  let polar = false, stretch = 1, drawnStretch = 1, pinPx = 1;
  // What a drag does in 3D: orbit the selected site (as since issue #77), or turn the whole Moon
  // like a ball about its centre, north up (the choice SPEC section 10 left open).
  let drag: 'site' | 'globe' = 'site';
  let facedKey = '';   // the site the globe view last turned to face
  let dem: Dem | null = null, coarse: Mesh | null = null, detail: Mesh | null = null;
  /** The height map the 3D meshes were last built from (they are built only for a 3D view). */
  let builtDem: Dem | null = null;
  /** A switch to 3D is waiting a frame to build its meshes, behind "Building the 3D view…". */
  let buildQueued = false;
  let bounds: GridBounds | undefined;
  let siteKey = '', coarseKey = '', detailKey = '', pinKey = '', themeKey = '', globeKey = '';
  /** The whole-Moon heights the globe is painted from. Null until they load, or if they are missing. */
  let globeHeights: GlobeHeights | null = null;
  /** The north cap: its heights (latitudes negated, see parseNorth), its mesh and the stretch it was built at. */
  let north: Dem | null = null, northMesh: Mesh | null = null, northKey = '', northStretch = 0;
  /** Level of detail: finer heights in tiles, and the patch of globe drawn from those round the middle of the view. */
  let tileIndex: TileIndex | null = null, patchMesh: Mesh | null = null, patchKey = '', patchStretch = 0;
  /** Where the patch is centred: the selected site when it is picked, then the ground the camera looks at (issue #85). */
  let patchCentre: Site | null = null, patchTimer = 0;
  let pinSites: AppState['sites'] | null = null, pinDem: Dem | null = null, pinPatch: Mesh | null = null;
  /**
   * Highest drawn ground above the sphere, in km, of the south-pole terrain, the north cap and the
   * patch, so the near plane never cuts a peak.
   */
  let relief = 0, northRelief = 0, patchRelief = 0;
  /** The selected site on the drawn surface. */
  const target = new Vector3();
  /** Everything the terrain meshes draw, so the Sun's shadow box can be fitted to it. */
  const terrainBox = new Box3(), shadowBox = new Box3();

  const world = new Scene();
  // Only the orbit view is 3D. The 2D map is web/src/map/ (T31): the 3D scene draws nothing in 2D mode.
  const orbitCamera = new PerspectiveCamera(45, 1, 0.02, 60_000);
  let orbitControls = makeOrbitControls(new Vector3(0, 1, 0));
  const sun = new DirectionalLight(); sun.intensity = 3; sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.00001; sun.shadow.normalBias = 0.002;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 4000;
  world.add(sun, sun.target);
  // A faint fill, so ground in shadow still shows its shape (through the height colours) instead of
  // matching the background; a shadowed crater floor stays dark. Illustrative, like the shadows.
  const ambient = new AmbientLight(); ambient.intensity = 0.3; world.add(ambient);
  // The Sun in the sky (issue #120), where the light comes from: its disc at true size, and a glare
  // of fixed size on screen so the few-pixel disc can be found (sun.ts). The Moon hides both by depth.
  const sunMaterial = new SpriteMaterial({ map: sunTexture(themeColor('--sun'), discAlpha), depthTest: true, depthWrite: false });
  const glareMaterial = new SpriteMaterial({ map: sunTexture(themeColor('--sun'), glareAlpha), depthTest: true, depthWrite: false });
  const sunDisc = new Sprite(sunMaterial); sunDisc.name = 'Sun'; sunDisc.visible = false; sunDisc.renderOrder = 2;
  const sunGlare = new Sprite(glareMaterial); sunGlare.name = 'Sun glare'; sunGlare.visible = false; sunGlare.renderOrder = 1;
  world.add(sunGlare, sunDisc);
  /** The glare's width on screen, in CSS pixels, from the theme (updateTheme). */
  let glarePx = 1;
  const terrainMaterial = new MeshLambertMaterial({ vertexColors: true });
  const detailMaterial = terrainMaterial.clone();
  // The globe is always drawn, with the terrain set into its south cap. Pushed back in depth so
  // the terrain wins where the two overlap at the cap's edge.
  const globeMaterial = new MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const globe = new Mesh(globeGeometry(null), globeMaterial);
  globe.position.copy(moonCentre()); world.add(globe);
  const earthMaterial = new SpriteMaterial({ map: earthTexture(), depthTest: true });
  const earth = new Sprite(earthMaterial); earth.name = 'Earth'; world.add(earth);
  const pins = new Group(); world.add(pins);
  // The poles (issue #107): a stub of the spin axis at each, labelled in the page over the canvas.
  const poles = poleLines(); world.add(poles);
  const poleTips = POLES.map((pole) => poleStub(pole)[1]);
  const poleLabels = POLES.map((pole) => {
    const label = document.createElement('span');
    label.className = 'scene-pole'; label.textContent = pole.label; label.hidden = true;
    label.title = pole.id === 'north' ? 'North pole' : 'South pole';
    label.setAttribute('aria-hidden', 'true');
    viewport.append(label);
    return label;
  });
  // The real sky behind the Moon (issue #80), turned with the Moon at the selected time.
  const stars = makeStarField(invalidate); world.add(stars.object);
  const pinGeometry = new SphereGeometry(1, 12, 8);
  const raycaster = new Raycaster(), pointer = new Vector2();
  let pointerDown: { x: number; y: number; id: number } | null = null, maxDrag = 0;

  /**
   * Orbit around the selected site, never below its horizon, with its vertical as the axis; the
   * whole Moon comes into view by zooming out. OrbitControls takes that axis from camera.up once,
   * when it is created, so a site with another vertical gets new controls.
   */
  function makeOrbitControls(up: Vector3): OrbitControls {
    orbitCamera.up.copy(up);
    const controls = new OrbitControls(orbitCamera, canvas);
    controls.addEventListener('change', invalidate);
    controls.addEventListener('change', followView);
    controls.minDistance = drag === 'globe' ? MOON_RADIUS_KM * 1.05 : 0.2;
    controls.maxDistance = MOON_RADIUS_KM * 6;
    // Orbiting the site: never below its horizon. Turning the Moon: all the way round, pole to pole.
    controls.maxPolarAngle = drag === 'globe' ? Math.PI : Math.PI * 0.49;
    controls.enablePan = drag !== 'globe';
    controls.enabled = controlsOn();
    return controls;
  }
  /** The orbit controls work in 3D, but not while a fade moves the camera (T29). */
  function controlsOn(): boolean {
    return mode === '3d' && !fade;
  }

  /** Pins keep the same size on screen at every zoom, sitting on the surface. */
  function sizePins(): void {
    const height = viewport.clientHeight || 1;
    for (const pin of pins.children) {
      const { base, up, scale } = pin.userData as PinData;
      const perPx = 2 * Math.tan(orbitCamera.fov * RAD / 2) * orbitCamera.position.distanceTo(base) / height;
      const r = pinPx * scale * perPx;
      pin.scale.setScalar(r);
      pin.position.copy(base).addScaledVector(up, r);
    }
  }
  /** The glare keeps its size on screen at every zoom, like the pins; the disc keeps its true size. */
  function sizeSun(): void {
    if (!sunDisc.visible) return;
    const perPx = 2 * Math.tan(orbitCamera.fov * RAD / 2) * orbitCamera.position.distanceTo(sunGlare.position) / (viewport.clientHeight || 1);
    sunGlare.scale.setScalar(Math.max(glarePx * perPx, sunDisc.scale.x));
  }
  function render(): void {
    // In 2D the flat map shows instead: nothing is drawn here, so no shadow map is rendered.
    // During a fade (T29) both show, and the camera is on its way between the two views.
    if (!fade && shown === 0) { placePoleLabels(); return; }
    const putBack = fade ? fadeCamera() : null;
    // The camera moves from metres above a crater to beyond the whole Moon: keep the depth
    // range tight around what can be seen, or near surfaces fight and far ones vanish.
    const fromCentre = orbitCamera.position.distanceTo(globe.position);
    orbitCamera.near = Math.min(1000, Math.max(0.005, (fromCentre - MOON_RADIUS_KM - Math.max(relief, northRelief, patchRelief)) / 2));
    orbitCamera.far = fromCentre + MOON_RADIUS_KM + SUN_DRAWN_KM * 1.1;
    orbitCamera.updateProjectionMatrix();
    sizePins(); sizeSun();
    fitShadow();
    renderer.render(world, orbitCamera);
    placePoleLabels();
    // Where this frame was drawn from, for the page test (web/e2e/transition.spec.ts).
    canvas.dataset.camera = orbitCamera.position.toArray().map((v) => v.toFixed(3)).join(',');
    putBack?.();
  }
  /**
   * T29: puts the camera, for this frame only, part of the way from straight above the selected
   * site (turned and zoomed like the 2D map) to its orbit view: as far as the 3D view shows.
   * Returns what puts it back, so picking, the patch and the controls keep the orbit view.
   */
  function fadeCamera(): () => void {
    const look = viewOf(mapHost);
    // Before the map has a size: as much ground as the orbit view shows at the site.
    const kmTall = look?.kmTall ?? 2 * Math.tan(orbitCamera.fov * RAD / 2) * orbitCamera.position.distanceTo(target);
    const above = abovePose(target, selected().site, look?.kind ?? (polar ? 'south' : 'global'), kmTall, orbitCamera.fov);
    const orbit = { position: orbitCamera.position.clone(), target: orbitControls.target.clone(), up: orbitCamera.up.clone() };
    const turn = orbitCamera.quaternion.clone();
    const pose = blendPose(above, orbit, shown);
    orbitCamera.position.copy(pose.position); orbitCamera.up.copy(pose.up); orbitCamera.lookAt(pose.target);
    return () => {
      orbitCamera.position.copy(orbit.position); orbitCamera.up.copy(orbit.up); orbitCamera.quaternion.copy(turn);
      orbitCamera.updateMatrixWorld();
    };
  }
  /** Each pole's label at its stub's tip, hidden when the tip is off screen or behind the Moon. */
  function placePoleLabels(): void {
    orbitCamera.updateMatrixWorld();
    poleTips.forEach((tip, i) => {
      const label = poleLabels[i];
      const at = shown > 0 && !hiddenByMoon(orbitCamera.position, tip) ? viewportFraction(orbitCamera, tip) : null;
      label.hidden = !at;
      label.style.opacity = fade ? String(shown) : '';   // fading with the 3D view (T29)
      if (at) { label.style.left = `${at.x * 100}%`; label.style.top = `${at.y * 100}%`; }
    });
  }
  /**
   * three.js leaves everything outside the Sun's shadow box unshadowed, which drew straight-edged
   * lit bands across dark ground. The box covers the whole terrain, because a peak far off screen
   * can still cast a shadow into view.
   */
  function fitShadow(): void {
    if (!sun.castShadow || !coarse || terrainBox.isEmpty()) return;
    const light = sun.shadow.camera;
    light.position.copy(sun.position); light.lookAt(sun.target.position); light.updateMatrixWorld();
    const box = shadowBox.copy(terrainBox).applyMatrix4(light.matrixWorldInverse);
    light.left = box.min.x; light.right = box.max.x; light.bottom = box.min.y; light.top = box.max.y;
    // The light looks down its -Z axis.
    light.near = Math.max(0.01, -box.max.z - 1); light.far = -box.min.z + 1;
    light.updateProjectionMatrix();
    // Depth bias stays about 40 m whatever the box's depth; the normal offset follows the texel size.
    sun.shadow.bias = -0.04 / (light.far - light.near);
    sun.shadow.normalBias = Math.max(0.002, (box.max.y - box.min.y) / sun.shadow.mapSize.y);
  }
  // No continuous animation while idle. Controls, state changes and resize schedule a frame; a
  // fade (T29) schedules one after another until it ends.
  function invalidate(): void {
    if (frame || disposed || lost) return;
    frame = requestAnimationFrame((now) => {
      frame = 0;
      if (disposed || lost) return;
      advanceFade(now);
      render();
      if (fade) invalidate();
    });
  }
  /** T29: the system asks for reduced motion, so a change of view jumps, as before T29. */
  function reduceMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  /** T29: a change of mode fades to the new view, from wherever the view is now, or jumps. */
  function beginFade(): void {
    const goal = mode === '3d' ? 1 : 0;
    fade = reduceMotion() || lost ? null : startFade(shown, goal);
    if (!fade) shown = goal;
  }
  /** T29: moves a fade on to this frame. The first build of the 3D view holds it at its start. */
  function advanceFade(now: number): void {
    if (!fade) return;
    shown = stepFade(fade, now, buildQueued);
    if (fadeDone(fade)) { shown = fade.to; fade = null; }
    showViews();
  }
  /**
   * Which view shows (T29). The map lies over the 3D canvas: while they fade, both are there, the
   * map at 1 - shown, and neither takes a click (scene.css); after it, only one.
   */
  function showViews(): void {
    // scene.css gives the canvas display: block, which the hidden attribute would not override.
    canvas.style.display = fade || shown > 0 ? '' : 'none';
    mapHost.hidden = !fade && shown >= 1;
    mapHost.style.opacity = fade ? String(1 - shown) : '';
    viewport.classList.toggle('scene-fading', !!fade);
    viewport.dataset.fade = shown.toFixed(3);   // for the page test (web/e2e/transition.spec.ts)
    orbitControls.enabled = controlsOn();
  }
  function resize(): void {
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    orbitCamera.aspect = aspect; orbitCamera.updateProjectionMatrix(); invalidate();
  }
  /**
   * The globe view: the camera on the Moon's centre with north up, far enough out to see the
   * whole Moon, looking at the selected site (faceSite) or from where it already is.
   */
  function globeView(faceSite: boolean): void {
    const middle = moonCentre();
    const north = siteUp({ lat: 90, lon: 0 });
    const site = selected().site;
    let dir = faceSite ? siteUp(site) : orbitCamera.position.clone().sub(middle).normalize();
    // Straight over a pole the view would have no "up": lean off it a little, toward longitude 0.
    if (Math.abs(dir.dot(north)) > 0.97) {
      const across = siteUp({ lat: 0, lon: site.lon }).addScaledVector(north, -siteUp({ lat: 0, lon: site.lon }).dot(north)).normalize();
      dir = dir.clone().addScaledVector(across, 0.35).normalize();
    }
    const dist = Math.max(orbitCamera.position.distanceTo(middle), MOON_RADIUS_KM * 2.6);
    orbitControls.dispose();
    orbitControls = makeOrbitControls(north);
    orbitControls.target.copy(middle);
    orbitCamera.position.copy(middle).addScaledVector(dir, Math.min(dist, MOON_RADIUS_KM * 4));
    orbitCamera.lookAt(middle); orbitControls.update();
    facedKey = `${site.lat},${site.lon}`;
    invalidate();
  }
  /** Switches what a drag does, and frames the view for it. */
  function setDrag(next: 'site' | 'globe'): void {
    if (next === drag) return;
    drag = next;
    for (const b of dragButtons) {
      const on = b.dataset.drag === drag;
      b.classList.toggle('btn-primary', on); b.setAttribute('aria-pressed', String(on));
    }
    if (drag === 'globe') globeView(true);
    else centre();
    update(getState());
  }
  /** Resets the orbit camera, and the flat map, to their starting view of the selected site. */
  function centre(): void {
    if (drag === 'globe') { globeView(true); centreMap(); resize(); return; }
    // The patch goes back to the site with the view, not 200 ms later through followView.
    clearTimeout(patchTimer); patchCentre = selected().site; updatePatch();
    const up = siteUp(selected().site);
    orbitControls.dispose();
    orbitControls = makeOrbitControls(up);
    orbitControls.target.copy(target);
    if (polar && dem) {
      const span = Math.max(8, Math.min(80, dem.meta.size * dem.meta.pixel_m / 8000));
      orbitCamera.position.copy(target).add(new Vector3(span * 0.6, span * 0.9, span * 1.1));
    } else {
      // The polar view's angle in the site's own frame: at the pole, (0.6, 0.9, 1.1) above is 0.6
      // east, 0.9 up and 1.1 against siteNorth. So here too the camera looks north across the site.
      const northward = siteNorth(up), east = northward.clone().cross(up);
      orbitCamera.position.copy(target).addScaledVector(east, SITE_SPAN_KM * 0.6)
        .addScaledVector(up, SITE_SPAN_KM * 0.9).addScaledVector(northward, -SITE_SPAN_KM * 1.1);
    }
    orbitCamera.lookAt(orbitControls.target); orbitControls.update(); invalidate();
    centreMap(); resize();
  }
  /** Brings the selected site back to the middle of the orbit view, keeping zoom and viewing angle. The map follows by itself. */
  function follow(): void {
    if (drag === 'globe') {
      // Turning the Moon: a new site turns the Moon to face it; anything else leaves the view be.
      const site = selected().site;
      if (`${site.lat},${site.lon}` !== facedKey) globeView(true);
      return;
    }
    const offset = orbitCamera.position.clone().sub(orbitControls.target);
    // Off the height map the next site may be far round the Moon: the orbit's axis turns to its
    // vertical, and the camera keeps its place in the site's own frame. On the height map, sites
    // are at most 10 degrees apart and the axis stays as centre() set it.
    const up = siteUp(selected().site);
    if (!polar && up.distanceToSquared(orbitCamera.up) > 1e-12) {
      offset.copy(carryOffset(offset, orbitCamera.up, up));
      orbitControls.dispose();
      orbitControls = makeOrbitControls(up);
    }
    orbitControls.target.copy(target);
    orbitCamera.position.copy(target).add(offset);
    orbitControls.update(); invalidate();
  }
  function clearTerrain(): void {
    for (const mesh of [coarse, detail]) if (mesh) { world.remove(mesh); mesh.geometry.dispose(); }
    coarse = detail = null; coarseKey = detailKey = ''; relief = 0; bounds = undefined;
    terrainBox.makeEmpty();
  }
  /**
   * The whole region is built once per height map, stretch and theme, and shown in every view.
   * A new site only rebuilds the small native patch and moves the hole under it.
   */
  function updateTerrain(changedDem: boolean): void {
    if (changedDem) {
      clearTerrain();
      const old = globe.geometry; globe.geometry = globeGeometry(dem?.meta, north?.meta); old.dispose();
    }
    if (!dem) return;
    const low = new Color(themeColor('--terrain-lo')), high = new Color(themeColor('--terrain-hi'));
    const nextCoarse = `${stretch}|${themeKey}`;
    if (!coarse || coarseKey !== nextCoarse) {
      if (coarse) { world.remove(coarse); coarse.geometry.dispose(); }
      coarse = new Mesh(terrainGeometry(dem, low, high, stretch), terrainMaterial);
      coarse.castShadow = coarse.receiveShadow = true; world.add(coarse);
      coarse.geometry.computeBoundingBox();
      coarseKey = nextCoarse; detailKey = '';
      const [min, max] = coarse.geometry.userData.heightRange as number[];
      relief = Math.max(0, max) * stretch / 1000;
      // The sphere outside the height map takes the colour of the ground along the map's edge.
      const edge = (edgeHeight(coarse.geometry) - min) / Math.max(1, max - min);
      globeMaterial.color.copy(low).lerp(high, Math.max(0, Math.min(1, edge)));
    }
    const nextDetail = polar ? `${siteKey}|${coarseKey}` : 'none';
    if (detailKey === nextDetail) return;
    detailKey = nextDetail;
    if (detail) { world.remove(detail); detail.geometry.dispose(); detail = null; }
    bounds = polar ? detailBounds(dem, selected().site) : undefined;
    setTerrainHole(coarse.geometry, bounds);
    terrainBox.copy(coarse.geometry.boundingBox!);
    if (!bounds) return;
    detail = new Mesh(terrainGeometry(dem, low, high, stretch, bounds), detailMaterial);
    recolorTerrain(detail.geometry, low, high, coarse.geometry.userData.heightRange as number[]);
    detail.geometry.computeBoundingBox(); terrainBox.union(detail.geometry.boundingBox!);
    detail.castShadow = detail.receiveShadow = true; world.add(detail);
  }
  /** The heights the colour ramp spans: the terrain's own once it is in, so the two match. */
  function globeRange(heights: GlobeHeights): number[] {
    return (coarse?.geometry.userData.heightRange as number[] | undefined) ?? heights.range;
  }
  function clearPatch(): void {
    if (patchMesh) { world.remove(patchMesh); patchMesh.geometry.dispose(); patchMesh = null; }
    patchRelief = 0; delete canvas.dataset.patch;
  }
  /**
   * Level of detail (issues #66, #85): in the 3D globe view, the ground round the middle of the
   * view is drawn from finer heights, raised with the vertical stretch. It starts at the selected
   * site and follows the camera (followView). Only the tiles under it are fetched; the last patch
   * stays until the new one is ready. The polar meshes cover their own ground.
   */
  function updatePatch(): void {
    // Not while the 3D build waits a frame: without the north cap yet, the ground under a site
    // there would look uncovered and get a patch drawn over the cap.
    if (buildQueued) return;
    const heights = globeHeights, index = tileIndex, centre = patchCentre ?? selected().site;
    const south = dem ? dem.meta.min_lat : -90, top = northMesh && north ? -north.meta.min_lat : 90;
    const win = heights && index && mode === '3d' && !polar ? patchWindow(centre, index, south, top) : null;
    if (!heights || !index || !win || centre.lat >= top) {
      if (polar || !heights) { clearPatch(); patchKey = ''; }
      return;
    }
    const range = globeRange(heights);
    const key = `${win.row0},${win.col0},${win.row1},${win.col1}|${themeKey}|${range.join(',')}|${south}|${top}`;
    if (key === patchKey) return;
    patchKey = key;
    loadWindow(index, win).then((heightAt) => {
      if (disposed || patchKey !== key) return;
      const geometry = patchGeometry(win, index, heightAt,
        new Color(themeColor('--terrain-lo')), new Color(themeColor('--terrain-hi')), range, undefined,
        (lat, lon, out) => globeNormalNear(heights, lat, lon, GLOBE_RELIEF, out));
      clearPatch();
      patchMesh = new Mesh(geometry, terrainMaterial); patchMesh.position.copy(globe.position);
      // Where the patch is, for the browser check (browser-check.py).
      canvas.dataset.patch = `${centre.lat},${centre.lon}`;
      // update() raises it to the stretch, and puts the site, its pins and the camera on it.
      patchStretch = 0; world.add(patchMesh); update(getState());
    }).catch(() => { if (patchKey === key) patchKey = ''; });
  }
  /**
   * Moves the patch to the ground in the middle of the view once the camera settles (issue #85),
   * when that is more than PATCH_MOVE_DEG from the patch's centre, so a small orbit costs nothing.
   */
  function followView(): void {
    if (mode !== '3d' || polar || !globeHeights || !tileIndex) return;
    clearTimeout(patchTimer);
    patchTimer = window.setTimeout(() => {
      if (disposed) return;
      const centre = viewGround(orbitCamera.position, orbitCamera.getWorldDirection(new Vector3()));
      if (patchCentre && groundAngle(centre, patchCentre) < PATCH_MOVE_DEG) return;
      patchCentre = centre; updatePatch();
    }, 200);
  }
  /** Raises the patch to the current stretch, if it isn't there already. */
  function stretchPatchMesh(): void {
    if (!patchMesh || patchStretch === stretch) return;
    patchRelief = stretchPatch(patchMesh.geometry, stretch); patchStretch = stretch;
  }
  /**
   * Paints the globe with the whole Moon's heights (issue #66), on the terrain's colour ramp and
   * range so no ring shows where the height map stops. Without them it stays a plain sphere.
   */
  function paintGlobe(): void {
    if (!globeHeights) return;
    // The texture carries the colour; the material's own would tint it.
    globeMaterial.color.set(0xffffff);
    const range = globeRange(globeHeights);
    const key = `${themeKey}|${range.join(',')}`;
    if (northMesh && northKey !== key) {
      northKey = key;
      recolorTerrain(northMesh.geometry,
        new Color(themeColor('--terrain-lo')), new Color(themeColor('--terrain-hi')), range);
    }
    if (key === globeKey) return;
    globeKey = key;
    const old = globeMaterial.map;
    globeMaterial.map = colorTexture(globeHeights,
      new Color(themeColor('--terrain-lo')), new Color(themeColor('--terrain-hi')), range);
    old?.dispose();
    if (!globeMaterial.normalMap) {
      globeMaterial.normalMap = normalTexture(globeHeights);
      globeMaterial.normalMapType = ObjectSpaceNormalMap;
    }
    globeMaterial.needsUpdate = true;
  }
  /**
   * The cap north of 80 N is a mesh on a square polar grid, like the south-pole terrain: the
   * globe's latitude-longitude texture pinches together at a pole. Drawn only on a painted globe,
   * and raised with the stretch like the south-pole terrain.
   */
  function buildNorth(): void {
    if (!north || !globeHeights) return;
    if (northMesh) {
      // Its shading doesn't change with the stretch, so its points move instead of a rebuild.
      if (northStretch === stretch) return;
      restretchTerrain(northMesh.geometry, stretch);
    } else {
      northMesh = new Mesh(northGeometry(north, new Color(themeColor('--terrain-lo')),
        new Color(themeColor('--terrain-hi')), NORTH_RELIEF, stretch), terrainMaterial);
      world.add(northMesh);
      const old = globe.geometry; globe.geometry = globeGeometry(dem?.meta, north.meta); old.dispose();
      northKey = '';
    }
    northStretch = stretch;
    northRelief = Math.max(0, (northMesh.geometry.userData.heightRange as number[])[1]) * stretch / 1000;
    pinKey = '';
  }
  /**
   * A site's height on the ground as drawn, in metres before the stretch: the south-pole terrain,
   * the north cap or the level-of-detail patch, and the bare sphere anywhere else.
   */
  function drawnHeight(site: Site): number {
    if (dem?.covers(site.lat, site.lon)) return drawnDemHeight(dem, site.lat, site.lon);
    if (northMesh && north?.covers(-site.lat, site.lon)) return drawnDemHeight(north, -site.lat, site.lon);
    return patchMesh ? patchLiftAt(patchMesh.geometry, site.lat, site.lon) * 1000 : 0;
  }
  function clearPins(): void {
    for (const obj of [...pins.children]) { ((obj as Mesh).material as Material).dispose(); pins.remove(obj); }
  }
  function updatePins(s: AppState): void {
    const scenarios = [s.live, ...s.pinned, ...(s.ghost ? [s.ghost] : [])];
    const key = [themeKey, stretch, s.selectedId,
      ...scenarios.map((sc) => `${sc.id} ${sc.color} ${sc.label} ${sc.site.lat} ${sc.site.lon}`)].join('|');
    // Scrubbing time changes none of this, so the pins aren't rebuilt at every step of a drag.
    if (key === pinKey && pinSites === s.sites && pinDem === dem && pinPatch === patchMesh) return;
    pinKey = key; pinSites = s.sites; pinDem = dem; pinPatch = patchMesh;
    clearPins();
    const addPin = (site: Site, color: string, label: string, id?: string): void => {
      const pin = new Mesh(pinGeometry, new MeshBasicMaterial({ color: themeColor(color) }));
      const data: PinData = {
        site, scenarioId: id, label, base: sitePosition(site, drawnHeight(site), stretch), up: siteUp(site),
        scale: id !== undefined && id === s.selectedId ? 1.6 : 1,
      };
      pin.userData = data; pins.add(pin);
    };
    s.sites.forEach((site) => addPin(site, '--muted', site.name));
    scenarios.forEach((sc) => addPin(sc.site, sc.color, sc.label, sc.id));
  }
  function update(s: AppState): void {
    const sc = selected();
    const nextPolar = !!s.dem && s.dem.covers(sc.site.lat, sc.site.lon);
    const key = `${sc.site.lat},${sc.site.lon}`;
    const changedDem = dem !== s.dem, changedView = polar !== nextPolar, changedSite = siteKey !== key;
    const changedMode = mode !== s.mode, changedStretch = drawnStretch !== stretch;
    dem = s.dem; polar = nextPolar; mode = s.mode; siteKey = key; drawnStretch = stretch;
    if (changedMode) beginFade();
    if (changedSite) patchCentre = sc.site;
    // The 3D meshes and textures are built the first time a 3D view shows, not behind the 2D map
    // the page opens on: building them there froze the page for about 2 s after it looked ready,
    // as the height map and then globe.bin arrived (issue #118).
    if (mode !== '2d' && !buildQueued) {
      const unbuilt = builtDem !== dem || (!!north && !!globeHeights && !northMesh) || (!!globeHeights && !globeMaterial.map);
      if (changedMode && unbuilt) {
        // The first switch to 3D builds for about a second: say so first, so the click answers at
        // once, and build a frame later.
        buildQueued = true;
        requestAnimationFrame(() => setTimeout(() => { buildQueued = false; if (!disposed) update(getState()); }, 0));
      } else {
        updateTerrain(builtDem !== dem); builtDem = dem;
        buildNorth();
        paintGlobe();
      }
    }
    updatePatch();
    stretchPatchMesh();
    // On the ground as drawn, so the camera orbits the site itself and follows it when a patch arrives.
    const lastTarget = target.clone();
    target.copy(sitePosition(sc.site, drawnHeight(sc.site), stretch));
    const changedTarget = !target.equals(lastTarget);
    // Stretch is drawn only in 3D, wherever the site is; the flat map shows heights as colours.
    slider.disabled = !dem || mode === '2d';
    showViews();
    for (const button of buttons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle('btn-primary', active); button.setAttribute('aria-pressed', String(active));
    }
    if (!framed || changedDem || changedView) { framed = true; centre(); }
    else if (changedSite || changedMode || changedStretch) follow();
    // The ground under the site was redrawn (a patch came or went): the view moves with the site,
    // unless it was panned away from it, which the patch following the camera must not undo.
    else if (changedTarget && orbitControls.target.distanceTo(lastTarget) < 1e-6) follow();
    updatePins(s);
    sun.target.position.copy(target);
    stars.turn(multiply(MOON_TO_SCENE, moonFromIcrf(sc.tMs)));
    // vectorsAt answers a time it has no row for (outside 1900-2100, or in a decade that failed
    // to download) with the nearest row it does have. Lighting the scene from that would show a
    // picture of some other date while the readout says the time has no row.
    const tabled = !!s.eph && sc.tMs >= s.eph.startMs && sc.tMs <= s.eph.endMs
      && s.eph.missing(sc.tMs, sc.tMs).length === 0;
    if (s.eph && tabled) {
      const vectors = s.eph.vectorsAt(sc.tMs);
      sun.position.copy(target).addScaledVector(moonDirection(vectors.sun), 2000); sun.intensity = 3;
      sun.castShadow = polar;
      sunDisc.position.copy(target).addScaledVector(moonDirection(vectors.sun), SUN_DRAWN_KM);
      sunDisc.scale.setScalar(sunDiscScale(SUN_DRAWN_KM)); sunGlare.position.copy(sunDisc.position);
      sunDisc.visible = sunGlare.visible = true;
      // Seen from the site, not the Moon's centre: Earth is close enough for that to matter.
      const toEarth = moonDirection(vectors.earthKm).add(globe.position).sub(target);
      const distance = toEarth.length();
      earth.position.copy(target).addScaledVector(toEarth.normalize(), EARTH_DRAWN_KM);
      earth.scale.setScalar(2 * EARTH_RADIUS_KM * EARTH_DRAWN_KM / distance); earth.visible = true;
    } else { sun.intensity = 0; earth.visible = false; sunDisc.visible = sunGlare.visible = false; }
    if (!lost) {
      message.hidden = tabled && !buildQueued;
      message.textContent = buildQueued ? 'Building the 3D view…'
        : s.eph ? noRowText(tableGap(sc.tMs), sc.tMs) : 'Loading Sun and Earth table…';
    }
    // The same cached sample the readout shows, so the two never disagree.
    const now: Sample | undefined = samplesFor(sc, '30d')[0];
    const mock = dem?.meta.source === 'mock' || s.eph?.meta.source === 'mock';
    const whole = mode === '2d' ? 'Whole-Moon map' : 'Moon globe';
    caption.textContent = [mock ? 'Mock data' : '',
      polar ? (mode === '2d' ? 'South-pole terrain · polar stereographic' : 'South-pole terrain')
        : `${whole}${mode === '2d' ? ' · equidistant cylindrical' : ''} · ${dem ? 'outside terrain coverage' : 'Loading height map'}`,
      now ? (now.sunFrac > 0 ? 'Sun visible' : 'Sun hidden') : '',
      stretch > 1 && dem ? 'Heights exaggerated; shadows are illustrative' : 'Lighting is illustrative; use the readout for visibility',
    ].filter(Boolean).join(' · ');
    help.textContent = mode === '2d' ? 'Click to pick a site · drag to pan · scroll to zoom'
      : drag === 'globe' ? 'Click to pick a site · drag to turn the Moon · scroll to zoom'
        : 'Click to pick a site · drag to orbit · right-drag to pan · scroll to zoom';
    dragGroup.hidden = mode === '2d';
    invalidate();
  }
  function updateTheme(): void {
    const key = ['--bg', '--text', '--terrain-lo', '--terrain-hi', '--earth', '--muted', '--accent', '--scn-a', '--scn-b', '--scn-c', '--scn-ghost', '--space-1'].map(themeColor).join('|');
    if (key === themeKey) return;
    themeKey = key; world.background = new Color(themeColor('--bg'));
    // Three quarters of the smallest gap: about the size the pins had at the starting zoom.
    pinPx = Math.max(1, themeLength(viewport, '--space-1') * 0.75);
    poles.material.color.set(themeColor('--muted'));
    sun.color.set(themeColor('--text')); ambient.color.set(themeColor('--text'));
    // Until the height map arrives there is no 0 m colour; the middle of the ramp stands in.
    globeMaterial.color.set(themeColor('--terrain-lo')).lerp(new Color(themeColor('--terrain-hi')), 0.5);
    const old = earthMaterial.map; earthMaterial.map = earthTexture(); old?.dispose();
    for (const [material, alpha] of [[sunMaterial, discAlpha], [glareMaterial, glareAlpha]] as const) {
      const oldSun = material.map; material.map = sunTexture(themeColor('--sun'), alpha); oldSun?.dispose();
    }
    // Twice the largest gap each way: big enough to catch the eye, small next to the Moon.
    glarePx = themeLength(viewport, '--space-5') * 4;
    stars.recolor();
    update(getState());
  }
  function pick(event: PointerEvent): void {
    const start = pointerDown; pointerDown = null;
    // During a fade (T29) the camera on screen isn't the orbit camera: the click is ignored.
    if (!start || start.id !== event.pointerId || maxDrag > 5 || event.button !== 0 || lost || fade) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    sizePins(); world.updateMatrixWorld(true); orbitCamera.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, orbitCamera);
    const surface = raycaster.intersectObjects([detail, coarse, northMesh, patchMesh, globe].filter((m): m is Mesh => !!m), false)[0];
    const pin = raycaster.intersectObjects(pins.children, false).find((hit) => !surface || hit.distance <= surface.distance + 0.01);
    if (pin) {
      const data = pin.object.userData as PinData;
      if (data.scenarioId && getState().pinned.some((p) => p.id === data.scenarioId)) select(data.scenarioId);
      else setLiveSite(data.site);
    } else if (surface) {
      const uv = surface.object === coarse || surface.object === detail ? surface.uv : undefined;
      const site = uv && dem ? gridSite(dem.meta, uv.x * (dem.meta.size - 1), uv.y * (dem.meta.size - 1)) : sphereSite(surface.point);
      if (!uv || dem?.covers(site.lat, site.lon)) setLiveSite(site);
    }
  }
  const down = (event: PointerEvent): void => {
    // A second finger cancels the click; a new primary press always starts a fresh one.
    if (!event.isPrimary || event.button !== 0) { pointerDown = null; return; }
    pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId }; maxDrag = 0;
  };
  const move = (event: PointerEvent): void => { if (pointerDown) maxDrag = Math.max(maxDrag, Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)); };
  const cancel = (): void => { pointerDown = null; };
  const onLost = (event: Event): void => {
    // A fade can't go on without frames: finish it, so the map isn't left half faded.
    if (fade) { shown = fade.to; fade = null; showViews(); }
    event.preventDefault(); lost = true; message.hidden = false;
    message.textContent = 'Graphics paused. Waiting for the browser to restore the Moon explorer…';
  };
  const onRestored = (): void => { lost = false; update(getState()); };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', pick); canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
  const changeMode = (event: Event): void => setMode((event.currentTarget as HTMLButtonElement).dataset.mode as AppState['mode']);
  buttons.forEach((b) => b.addEventListener('click', changeMode));
  const changeDrag = (event: Event): void => setDrag((event.currentTarget as HTMLButtonElement).dataset.drag as 'site' | 'globe');
  dragButtons.forEach((b) => b.addEventListener('click', changeDrag));
  for (const b of dragButtons) {
    const on = b.dataset.drag === drag;
    b.classList.toggle('btn-primary', on); b.setAttribute('aria-pressed', String(on));
  }
  // The camera follows the site up or down with the stretch; it isn't reset.
  const onStretch = (): void => { stretch = Number(slider.value); output.value = `${stretch}×`; update(getState()); };
  slider.addEventListener('input', onStretch); reset.addEventListener('click', centre);
  const observer = new ResizeObserver(resize); observer.observe(viewport);
  const themeObserver = new MutationObserver(updateTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  const unsubscribe = subscribe(update);
  // Not needed for any number, so it loads after the height map (issue #96) and the plain sphere
  // shows meanwhile.
  Promise.all([sharedGlobe(), sharedNorth().catch(() => null), loadTileIndex().catch(() => null)]).then(([loaded, cap, tiles]) => {
    if (disposed) return;
    globeHeights = loaded; north = cap; tileIndex = tiles; update(getState());
  }).catch(() => { /* No whole-Moon heights (mock data set): the globe stays a plain sphere. */ });
  updateTheme(); resize();
  function dispose(): void {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); clearTimeout(patchTimer); unsubscribe(); observer.disconnect(); themeObserver.disconnect();
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', pick); canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
    slider.removeEventListener('input', onStretch); reset.removeEventListener('click', centre);
    buttons.forEach((b) => b.removeEventListener('click', changeMode)); dragButtons.forEach((b) => b.removeEventListener('click', changeDrag)); window.removeEventListener('pagehide', onPageHide);
    orbitControls.dispose(); clearTerrain(); clearPins(); northMesh?.geometry.dispose(); clearPatch(); unmountMap(mapHost);
    sunMaterial.map?.dispose(); sunMaterial.dispose(); glareMaterial.map?.dispose(); glareMaterial.dispose();
    pinGeometry.dispose(); globe.geometry.dispose(); globeMaterial.map?.dispose(); globeMaterial.normalMap?.dispose(); globeMaterial.dispose(); terrainMaterial.dispose(); detailMaterial.dispose();
    earthMaterial.map?.dispose(); earthMaterial.dispose(); sun.dispose(); stars.dispose();
    poles.geometry.dispose(); poles.material.dispose(); poleLabels.forEach((label) => label.remove());
    // Free the WebGL context now: browsers allow only a few, and a remount would leak one.
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); mounts.delete(el);
  }
  function onPageHide(event: PageTransitionEvent): void { if (!event.persisted) dispose(); }
  window.addEventListener('pagehide', onPageHide); mounts.set(el, dispose);
}
