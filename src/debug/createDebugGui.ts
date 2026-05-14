import * as dat from 'dat.gui';
import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { SharedBackdrop } from '../render/SharedBackdrop';
import type { ScrollController } from '../runtime/ScrollController';
import type { SceneStack } from '../runtime/SceneStack';
import type { TransitionRenderer } from '../runtime/TransitionRenderer';
import type { ModelScene } from '../scenes/ModelScene';
import type { SceneBase } from '../scenes/SceneBase';
import { ModelScene as ModelSceneClass } from '../scenes/ModelScene';
import { VideoScene } from '../scenes/VideoScene';

type EarthDebugControls = {
  earth: {
    bumpScale: number;
    roughnessLow: number;
    roughnessHigh: number;
    cloudLow: number;
    cloudHigh: number;
    cloudOpacity: number;
    cloudColor: string;
    nightIntensity: number;
    nightBlur: number;
    atmosphereDayColor: string;
    atmosphereTwilightColor: string;
    ringOpacity: number;
    ringEmissiveIntensity: number;
    sunIntensity: number;
    sunX: number;
    sunY: number;
    sunZ: number;
  };
  applyEarthDebug: () => void;
};

export interface DebugGuiOptions {
  engine: Engine;
  scroll: ScrollController;
  stack: SceneStack;
  transition: TransitionRenderer;
  backdrop: SharedBackdrop;
  sections: SceneBase[];
}

export interface DebugGui {
  gui: dat.GUI;
  update: () => void;
  destroy: () => void;
}

function hasEarthDebug(scene: SceneBase): scene is SceneBase & { debugControls: EarthDebugControls } {
  return Boolean((scene as unknown as { debugControls?: EarthDebugControls }).debugControls);
}

function addAction(folder: dat.GUI, label: string, onClick: () => void) {
  const actions: Record<string, () => void> = { [label]: onClick };
  return folder.add(actions, label).name(label);
}

function addLive(liveControllers: dat.GUIController[], controller: dat.GUIController) {
  liveControllers.push(controller);
  return controller;
}

function addModelFolder(sceneFolder: dat.GUI, scene: ModelScene) {
  const modelParams = {
    autoRotate: scene.getAutoRotate(),
    autoRotateSpeed: scene.getAutoRotateSpeed(),
    rotationX: scene.modelRoot.rotation.x,
    rotationY: scene.modelRoot.rotation.y,
    rotationZ: scene.modelRoot.rotation.z,
    rootScale: scene.modelRoot.scale.x,
    rootY: scene.modelRoot.position.y,
    cameraFov: scene.camera.fov,
    cameraX: scene.camera.position.x,
    cameraY: scene.camera.position.y,
    cameraZ: scene.camera.position.z,
  };

  const applyModel = () => {
    scene.setAutoRotate(modelParams.autoRotate);
    scene.setAutoRotateSpeed(modelParams.autoRotateSpeed);
    scene.modelRoot.rotation.set(modelParams.rotationX, modelParams.rotationY, modelParams.rotationZ);
    scene.modelRoot.scale.setScalar(modelParams.rootScale);
    scene.modelRoot.position.y = modelParams.rootY;
    scene.setCameraFov(modelParams.cameraFov);
    scene.camera.position.set(modelParams.cameraX, modelParams.cameraY, modelParams.cameraZ);
    scene.camera.lookAt(0, 0, 0);
  };

  sceneFolder.add(modelParams, 'autoRotate').name('auto rotate').onChange(applyModel);
  sceneFolder.add(modelParams, 'autoRotateSpeed', -1, 1, 0.005).name('rotate speed').onChange(applyModel);
  sceneFolder.add(modelParams, 'rotationX', -Math.PI, Math.PI, 0.005).name('rotation x').onChange(applyModel);
  sceneFolder.add(modelParams, 'rotationY', -Math.PI, Math.PI, 0.005).name('rotation y').onChange(applyModel);
  sceneFolder.add(modelParams, 'rotationZ', -Math.PI, Math.PI, 0.005).name('rotation z').onChange(applyModel);
  sceneFolder.add(modelParams, 'rootScale', 0.4, 2.2, 0.01).name('root scale').onChange(applyModel);
  sceneFolder.add(modelParams, 'rootY', -1.5, 1.5, 0.01).name('root y').onChange(applyModel);
  sceneFolder.add(modelParams, 'cameraFov', 15, 75, 0.5).name('camera fov').onChange(applyModel);
  sceneFolder.add(modelParams, 'cameraX', -8, 8, 0.05).name('camera x').onChange(applyModel);
  sceneFolder.add(modelParams, 'cameraY', -8, 8, 0.05).name('camera y').onChange(applyModel);
  sceneFolder.add(modelParams, 'cameraZ', 0.5, 10, 0.05).name('camera z').onChange(applyModel);
}

function addEarthFolder(sceneFolder: dat.GUI, debugControls: EarthDebugControls) {
  const earthParams = debugControls.earth;
  const applyEarth = debugControls.applyEarthDebug;
  const earthFolder = sceneFolder.addFolder('Earth Effect');

  const materialFolder = earthFolder.addFolder('Globe Material');
  materialFolder.add(earthParams, 'bumpScale', 0, 0.2, 0.001).name('Bump Scale').onChange(applyEarth);
  materialFolder.add(earthParams, 'roughnessLow', 0, 1, 0.01).name('Roughness Low').onChange(applyEarth);
  materialFolder.add(earthParams, 'roughnessHigh', 0, 1, 0.01).name('Roughness High').onChange(applyEarth);

  const cloudsFolder = earthFolder.addFolder('Clouds');
  cloudsFolder.add(earthParams, 'cloudLow', 0, 1, 0.01).name('Low Range').onChange(applyEarth);
  cloudsFolder.add(earthParams, 'cloudHigh', 0, 1, 0.01).name('High Range').onChange(applyEarth);
  cloudsFolder.add(earthParams, 'cloudOpacity', 0, 1, 0.01).name('Opacity').onChange(applyEarth);
  cloudsFolder.addColor(earthParams, 'cloudColor').name('Color').onChange(applyEarth);

  const nightFolder = earthFolder.addFolder('Night Lights');
  nightFolder.add(earthParams, 'nightIntensity', 0, 5, 0.05).name('Intensity').onChange(applyEarth);
  nightFolder.add(earthParams, 'nightBlur', 0, 10, 0.1).name('Glow Blur').onChange(applyEarth);

  const atmoFolder = earthFolder.addFolder('Atmosphere');
  atmoFolder.addColor(earthParams, 'atmosphereDayColor').name('Day Color').onChange(applyEarth);
  atmoFolder.addColor(earthParams, 'atmosphereTwilightColor').name('Twilight Color').onChange(applyEarth);

  const ringFolder = earthFolder.addFolder('Saturn Ring');
  ringFolder.add(earthParams, 'ringOpacity', 0, 1, 0.01).name('Opacity').onChange(applyEarth);
  ringFolder.add(earthParams, 'ringEmissiveIntensity', 0, 2, 0.01).name('Glow').onChange(applyEarth);

  const sunFolder = earthFolder.addFolder('Lighting (Sun)');
  sunFolder.add(earthParams, 'sunIntensity', 0, 5, 0.05).name('Intensity').onChange(applyEarth);
  sunFolder.add(earthParams, 'sunX', -1, 1, 0.01).name('Dir X').onChange(applyEarth);
  sunFolder.add(earthParams, 'sunY', -1, 1, 0.01).name('Dir Y').onChange(applyEarth);
  sunFolder.add(earthParams, 'sunZ', -1, 1, 0.01).name('Dir Z').onChange(applyEarth);
}

export function createDebugGui(opts: DebugGuiOptions): DebugGui {
  const gui = new dat.GUI({ name: 'FT Debug', width: 360 });
  const liveControllers: dat.GUIController[] = [];
  const root = gui.domElement.parentElement ?? gui.domElement;
  root.style.zIndex = '80';
  root.style.height = '100vh';
  root.style.maxHeight = '100vh';
  root.style.overflowY = 'auto';
  root.style.pointerEvents = 'none';
  gui.domElement.style.maxHeight = 'calc(100vh - 30px)';
  gui.domElement.style.overflowY = 'auto';
  gui.domElement.style.pointerEvents = 'auto';

  const engineParams = {
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    toneExposure: opts.engine.renderer.toneMappingExposure,
    clearColor: '#d7e0ec',
  };
  const engineFolder = gui.addFolder('Engine');
  engineFolder.add(engineParams, 'pixelRatio', 0.5, 2, 0.05).name('pixel ratio').onChange((value) => {
    opts.engine.renderer.setPixelRatio(value);
    opts.engine.renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
  engineFolder.add(engineParams, 'toneExposure', 0.1, 2.5, 0.01).name('exposure').onChange((value) => {
    opts.engine.renderer.toneMappingExposure = value;
  });
  engineFolder.addColor(engineParams, 'clearColor').name('clear color').onChange((value) => {
    opts.engine.renderer.setClearColor(new THREE.Color(value), 1);
  });
  addAction(engineFolder, 'pause engine', () => opts.engine.stop());
  addAction(engineFolder, 'resume engine', () => opts.engine.start());
  // engineFolder.open();

  const scrollParams = {
    ...opts.scroll.getDebugParams(),
    currentScene: 0,
  };
  const scrollFolder = gui.addFolder('Scroll');
  addLive(liveControllers, scrollFolder.add(scrollParams, 'progress', 0, 1, 0.001).name('progress').listen());
  addLive(liveControllers, scrollFolder.add(scrollParams, 'velocity', 0, 1, 0.001).name('velocity').listen());
  addLive(liveControllers, scrollFolder.add(scrollParams, 'currentScene', 0, opts.stack.length - 1, 1).name('scene').listen());
  scrollFolder.add(scrollParams, 'snapEnabled').name('snap').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'wheelInputScale', 0.2, 8, 0.05).name('wheel scale').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'velocityScale', 0.1, 4, 0.05).name('velocity scale').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'velocityDamping', 1, 18, 0.1).name('damping').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'snapIdleDelay', 0, 1000, 10).name('snap delay').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'snapDuration', 0.1, 3, 0.01).name('snap duration').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'overshootScale', 0, 0.6, 0.01).name('overshoot').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  scrollFolder.add(scrollParams, 'overshootMaxRatio', 0, 0.2, 0.005).name('max overshoot').onChange(() => opts.scroll.applyDebugParams(scrollParams));
  addAction(scrollFolder, 'go top', () => opts.scroll.scrollToProgress(0, { duration: 0.85 }));
  addAction(scrollFolder, 'go earth', () => {
    opts.scroll.scrollToProgress(1 / Math.max(opts.sections.length - 1, 1), { duration: 0.85 });
  });
  // scrollFolder.open();

  const transitionParams = opts.transition.getDebugParams();
  const transitionFolder = gui.addFolder('Transition');
  transitionFolder.add(transitionParams, 'chromaticStrength', 0, 1.5, 0.01).name('chromatic').onChange((value) => {
    opts.transition.setChromaticStrength(value);
  });
  transitionFolder.add(transitionParams, 'edgeSoftness', 0.05, 3, 0.01).name('edge softness').onChange((value) => {
    opts.transition.setEdgeSoftness(value);
  });
  transitionFolder.add(transitionParams, 'smearStrength', 0, 2, 0.01).name('smear power').onChange((value) => {
    opts.transition.setSmearStrength(value);
  });
  transitionFolder.add(transitionParams, 'smearLength', 0, 0.35, 0.001).name('smear length').onChange((value) => {
    opts.transition.setSmearLength(value);
  });
  transitionFolder.add(transitionParams, 'smearAngle', -Math.PI, Math.PI, 0.01).name('smear angle').onChange((value) => {
    opts.transition.setSmearAngle(value);
  });
  transitionFolder.add(transitionParams, 'fogWashStrength', 0, 1.5, 0.01).name('fog wash').onChange((value) => {
    opts.transition.setFogWashStrength(value);
  });
  transitionFolder.add(transitionParams, 'sceneBRevealStart', 0, 0.95, 0.01).name('B reveal').onChange((value) => {
    opts.transition.setSceneBRevealStart(value);
  });
  // transitionFolder.open();

  const backdropParams = {
    color1: '#aebdcd',
    color2: '#edf4f8',
    dotStrength: 0.13,
    blueNoiseStrength: 0.018,
    centerGlowStrength: 0.5,
  };
  const backdropFolder = gui.addFolder('Backdrop');
  backdropFolder.addColor(backdropParams, 'color1').name('top color').onChange((value) => opts.backdrop.setColor1(value));
  backdropFolder.addColor(backdropParams, 'color2').name('bottom color').onChange((value) => opts.backdrop.setColor2(value));
  backdropFolder.add(backdropParams, 'dotStrength', 0, 1, 0.005).name('dots').onChange((value) => opts.backdrop.setDotStrength(value));
  backdropFolder.add(backdropParams, 'blueNoiseStrength', 0, 0.15, 0.001).name('noise').onChange((value) => opts.backdrop.setBlueNoiseStrength(value));
  backdropFolder.add(backdropParams, 'centerGlowStrength', 0, 1, 0.005).name('center glow').onChange((value) => opts.backdrop.setCenterGlowStrength(value));
  // backdropFolder.open();

  const scenesFolder = gui.addFolder('Scenes');
  opts.sections.forEach((scene, index) => {
    const sceneFolder = scenesFolder.addFolder(`${index}. ${scene.name}`);
    const info = { camera: scene.camera.type };
    addLive(liveControllers, sceneFolder.add(info, 'camera').name('camera').listen());

    if (scene instanceof VideoScene) {
      const videoParams = {
        playbackRate: scene.video.playbackRate,
        muted: scene.video.muted,
        volume: scene.video.volume,
      };
      sceneFolder.add(videoParams, 'playbackRate', 0.25, 2, 0.05).name('video rate').onChange((value) => {
        scene.video.playbackRate = value;
      });
      sceneFolder.add(videoParams, 'muted').name('muted').onChange((value) => {
        scene.video.muted = value;
      });
      sceneFolder.add(videoParams, 'volume', 0, 1, 0.01).name('volume').onChange((value) => {
        scene.video.volume = value;
      });
    }

    if (scene instanceof ModelSceneClass) {
      addModelFolder(sceneFolder, scene);
    }

    if (hasEarthDebug(scene)) {
      addEarthFolder(sceneFolder, scene.debugControls);
    }
    scenesFolder.open();
  });

  return {
    gui,
    update() {
      const next = opts.scroll.getDebugParams();
      scrollParams.progress = next.progress;
      scrollParams.velocity = next.velocity;
      scrollParams.currentScene = Math.min(
        opts.stack.length - 1,
        Math.floor(next.progress * Math.max(opts.stack.length - 1, 1)),
      );
      for (const controller of liveControllers) {
        controller.updateDisplay();
      }
    },
    destroy() {
      gui.destroy();
    },
  };
}
