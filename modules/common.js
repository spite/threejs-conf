import {
  WebGLRenderer,
  PerspectiveCamera,
  OrthographicCamera,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  Clock,
} from "three";
import { OrbitControls } from "third_party/OrbitControls.js";


Math.seedrandom = function (seed) {};

// UI stuff


// Rendering stuff

const initialFov = 35;
const cameras = [];
const resizeFns = [];

let MAX_PIXEL_RATIO = 2;

function getWebGLRenderer() {
  const renderer = new WebGLRenderer({
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  document.body.appendChild(renderer.domElement);
  return renderer;
}

const renderer = getWebGLRenderer();

resize();

function getCamera(fov) {
  const camera = new PerspectiveCamera(
    fov ? fov : initialFov,
    renderer.domElement.width / renderer.domElement.height,
    0.1,
    100,
  );
  cameras.push(camera);
  resize();
  return camera;
}

window.addEventListener("resize", () => {
  resize();
});

function setMaxPixelRatio(value) {
  const next = Math.max(value, 0.5);
  if (next === MAX_PIXEL_RATIO) return;
  MAX_PIXEL_RATIO = next;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, next));
  resize();
}

function onResize(fn) {
  resizeFns.push(fn);
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);

  for (const fn of resizeFns) {
    fn(w, h);
  }

  for (const camera of cameras) {
    if (camera instanceof PerspectiveCamera) {
      camera.aspect = w / h;
      if (w < h) {
        const initialAspect = 1;
        const horizontalFOV =
          2 *
          Math.atan(Math.tan((initialFov * Math.PI) / 180 / 2) * initialAspect);
        const newVFovRad =
          2 * Math.atan(Math.tan(horizontalFOV / 2) / camera.aspect);
        const newVFovDeg = newVFovRad * (180 / Math.PI);
        camera.fov = newVFovDeg;
      } else {
        camera.fov = initialFov;
      }
      camera.updateProjectionMatrix();
    }
    if (camera instanceof OrthographicCamera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
}

let running = true;

function pause() {
  running = !running;
}

const EDITABLE = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"];

function isEditing(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || EDITABLE.includes(target.tagName))
  );
}

function toggleFullscreen() {
  const target = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
  target?.catch((e) => console.warn("fullscreen refused", e));
}

window.addEventListener("keydown", (e) => {
  if (isEditing(e.target)) return;

  if (e.code === "Space") {
    pause();
  }
  if (e.code === "Tab") {
    document.body.classList.toggle("hide-ui");
    e.preventDefault();
  }
  if (e.code === "KeyF") {
    toggleFullscreen();
  }
});

function render(fn) {
  requestAnimationFrame(() => render(fn));
  fn();
}

const camera = getCamera();
const controls = new OrbitControls(camera, renderer.domElement);

const clock = new Clock();

export {
  isEditing,
  setMaxPixelRatio,
  onResize,
  renderer,
  camera,
  controls,
  render,
  running,
  clock,
};
