import { signal, effect, untrack } from "reactive";
import { DEBUG_VIEWS } from "modules/debugViews.js";
import { LOOKS, FEELS } from "modules/defaults.js";


const LOOK_LABELS = {
  sunrise: "Sunrise",
  noir: "Noir",
  neon: "Neon",
  mellow: "Mellow",
  candy: "Candy",
  chrome: "Chrome",
  clay: "Clay",
  moss: "Moss",
  autumn: "Autumn",
};

const FEEL_LABELS = {
  settled: "Settled",
  rubber: "Rubber",
  syrup: "Syrup",
  zippy: "Zippy",
  swarm: "Swarm",
  stiff: "Stiff",
};

const sameValue = (a, b) =>
  Array.isArray(a)
    ? Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

function matchingPreset(table, params) {
  for (const [name, preset] of Object.entries(table)) {
    let hit = true;
    for (const [key, value] of Object.entries(preset)) {
      if (!sameValue(value, params[key].peek())) {
        hit = false;
        break;
      }
    }
    if (hit) return name;
  }
  return "";
}

function presetPicker(gui, label, table, labels, params, apply, options) {
  const keys = Object.keys(Object.values(table)[0]);
  const choice = signal("");
  const list = [["", "Custom"], ...Object.keys(table).map((n) => [n, labels[n]])];

  gui.addSelect(label, choice, list, {
    ...options,
    onChange: (name) => name && apply(name),
  });

  effect(() => {
    for (const key of keys) params[key]();
    untrack(() => choice.set(matchingPreset(table, params)));
  });
}

const fmtInt = (v) => Math.round(v).toLocaleString();
const fmtMs = (v) => `${v.toFixed(1)} ms`;
const fmt3 = (v) => v.toFixed(3);
const fmtAttract = (v) =>
  v === -2 ? "paused" : v === -1 ? "off" : v === 0 ? "playing" : `${v.toFixed(1)} s`;

function buildPanel(gui, params, actions, stats) {
  gui.addButtons("Settings", [
    { label: "Reset All", onClick: actions.resetParams, title: "Back to defaults" },
    { label: "Copy Link", onClick: actions.copyStateLink, title: "Link to this state" },
  ]);

  gui.addTab("Help");
  gui.addText(
    "<b>Drag</b> to orbit, <b>scroll</b> to zoom." +
    "<br><b>Move</b> the mouse to nudge the letters." +
    "<br><b>Hold</b> to gather them onto the light, <b>release</b> to throw them." +
    "<br><b>Shift</b> gathers them without clicking." +
    "<br><b>Alt</b> lets you orbit without disturbing them." +
    "<br><b>F</b> goes fullscreen." +
    "<br><b>Space</b> pauses, <b>Tab</b> hides this panel.",
  );
  gui.addSection("Presets");
  gui.addButtons("Quality", [
    { label: "Low", onClick: () => actions.applyQuality("low"), title: "Cheapest: no bloom, no motion blur, no aberration, flat cursor shadows" },
    { label: "Medium", onClick: () => actions.applyQuality("medium"), title: "Bloom and motion blur on, softer cursor shadows, no aberration" },
    { label: "High", onClick: () => actions.applyQuality("high"), title: "Everything on at sensible detail" },
    { label: "Ultra", onClick: () => actions.applyQuality("ultra"), title: "Maximum detail and sample counts. Expect a long rebuild" },
  ]);
  presetPicker(gui, "Look", LOOKS, LOOK_LABELS, params, actions.applyLook,
    { title: "Whole-scene looks: colour, material, lights and the post chain. Shows Custom once you change any of them." },
  );
  presetPicker(gui, "Feel", FEELS, FEEL_LABELS, params, actions.applyFeel,
    { title: "How the letters move: springs, drag, bounce and how clicks throw them. Shows Custom once you change any of them." },
  );
  gui.addSection("Attract Mode", { open: false });
  gui.addSlider("Starts After", params.attract, 0, 120, 1,
    { title: "Seconds of no mouse or keyboard before the piece starts playing by itself, so it is never sitting dead on an unattended screen. 0 turns it off. Any input stops it at once." },
  );
  gui.addSlider("Camera Drift", params.attractSpin, 0, 4, 0.05,
    { title: "How fast the camera drifts around while it is playing by itself. 0 leaves the camera still." },
  );
  gui.addSlider("Throw Every", params.attractBurst, 0, 20, 0.5,
    { title: "Roughly how many seconds between the throws it fires on its own. 0 leaves the letters alone and only spins the camera." },
  );
  gui.addMonitor("Takes Over In", stats.attract, { format: fmtAttract,
    title: "Counts down while you are still. Reads playing once it has taken over, and resets the moment you touch anything.",
  });

  gui.addTab("Text");
  gui.addButton("Regenerate", actions.regenerate,
    { title: "Rebuilds the letters with the settings on this tab. Changes here only take effect when you press this." },
  );
  gui.addSection("Content");
  gui.addTextInput("Line 1", params.line1, { title: "The top line of text." });
  gui.addTextInput("Line 2", params.line2, { title: "The second line of text." });
  gui.addSlider("Line Spacing", params.lineSpacing, 0.6, 2.5, 0.01,
    { title: "How far apart the two lines sit. Low values overlap them, high values push them apart." },
  );
  gui.addCheckbox("Match Width", params.matchWidth,
    { title: "Grows the second line so both lines end up the same width." },
  );
  gui.addCheckbox("Match Depth", params.matchDepth,
    { title: "Keeps every letter equally thick, so the bigger line doesn't end up chunkier than the other." },
  );
  gui.addSection("Shape");
  gui.addSlider("Cap Height", params.capHeight, 0.4, 1.8, 0.01, { title: "Overall size of the text." });
  gui.addSlider("Depth", params.depth, 0.06, 1.0, 0.01, { title: "How thick the letters are, front to back." });
  gui.addSlider("Round", params.round, 0, 1, 0.01,
    { title: "How rounded the edges are. 0 is a sharp corner, 1 is as soft as the thickness allows." },
  );
  gui.addSlider("Normal Smooth", params.normalSmooth, 0, 1, 0.01,
    { title: "Softens hard shading seams where the outline turns a corner. Higher is smoother." },
  );
  gui.addSelect("Edge", params.edge, [
    ["round", "Round"],
    ["bevel", "Bevel"],
  ],
    { title: "Rounded or angled edges." },
  );
  gui.addSection("Meshing", { open: false });
  gui.addSlider("Resolution", params.resolution, 32, 160, 8,
    { title: "Detail of the letter shapes. Higher looks better but takes noticeably longer to rebuild." },
  );
  gui.addSlider("Curve Steps", params.curveSteps, 2, 24, 1,
    { title: "How finely curves are followed. Higher is rounder, and slower to build." },
  );

  gui.addTab("Look");
  gui.addSection("Colour");
  gui.addSlider("Hue Spread", params.hueSpread, 0, 1, 0.01,
    { title: "How much the letters differ in colour from each other. 0 makes them all the same." },
  );
  gui.addSlider("Saturation", params.saturation, 0, 1, 0.01, { title: "How vivid the colours are. 0 is grey." });
  gui.addSlider("Lightness", params.lightness, 0.1, 0.9, 0.01, { title: "How light or dark the letters are." });
  gui.addButton("Random", actions.randomize, { title: "Picks a new colour and a new pattern." });
  gui.addSection("Stamps");
  gui.addSlider("Stamp Density", params.stampDensity, 0, 3, 0.01,
    { title: "How many little letters are scattered over each patch of surface. Changing their size does not change how many there are." },
  );
  gui.addRangeSlider("Stamp Size", params.stampSize, 0.05, 2, 0.01,
    { title: "The smallest and largest a scattered letter can be. Drag the ends together for one uniform size, apart for a jumble." },
  );
  gui.addSlider("Stamp Roughness", params.stampRoughness, -1, 1, 0.01,
    { title: "How much the pattern varies the surface finish. 0 leaves it even, positive makes the raised stamps matte, negative makes them the shiny part instead." },
  );
  gui.addSlider("Stamp Opacity", params.stampOpacity, 0, 1, 0.01,
    { title: "How strongly each stamp marks the surface. Low values leave a faint wash, 1 is the full mark." },
  );
  gui.addSlider("Texture Scale", params.texScale, 0.25, 8, 0.05,
    { title: "How big the pattern appears on the letters. Higher makes it smaller and busier." },
  );
  gui.addSlider("Blend Sharpness", params.blendSharpness, 1, 8, 0.1,
    { title: "How crisply the stamp pattern commits to one direction where a letter curves. Low smears it across the rounded edges and side walls; the flat faces look the same either way. Above about 6 nothing more changes." },
  );
  gui.addSlider("Normal Strength", params.normalStrength, -1, 1, 0.01,
    { title: "How raised the pattern feels. 0 is flat, and negative values push the pattern in instead of out." },
  );
  gui.addSection("Material");
  gui.addSlider("Roughness", params.roughness, 0, 1, 0.01, { title: "Shiny to matte. 0 is mirror-like, 1 is chalky." });
  gui.addSlider("Metalness", params.metalness, 0, 1, 0.01, { title: "How metallic the surface looks." });
  gui.addSlider("Env Intensity", params.envMapIntensity, 0, 4, 0.01,
    { title: "How strongly the surroundings reflect in the letters." },
  );
  gui.addSlider("Rim Light", params.rim, 0, 6, 0.01,
    { title: "Glow around the silhouette of each letter, tinted with the background colour so they melt into it. 0 turns it off." },
  );
  gui.addSlider("Rim Falloff", params.rimPower, 0.5, 8, 0.1,
    { title: "How tightly that glow hugs the edges. Higher keeps it to a thin outline." },
  );

  gui.addSection("Subsurface", { open: false });
  gui.addSlider("Wax / SSS", params.sss, 0, 3, 0.01,
    { title: "Makes the letters look waxy, as if light glows through the thin parts. 0 turns it off." },
  );
  gui.addSlider("SSS Falloff", params.sssPower, 0.5, 12, 0.1,
    { title: "How focused the glow is. Higher keeps it to where the light shines straight through." },
  );
  gui.addSlider("SSS Distortion", params.sssDistortion, 0, 1, 0.01,
    { title: "Spreads the glow further around the edges." },
  );
  gui.addSlider("SSS Density", params.sssDensity, 0, 60, 0.5,
    { title: "How easily light gets through. Higher means only the thinnest parts glow." },
  );

  gui.addTab("Lighting");
  gui.addSection("Scene Lights");
  gui.addColor("Key Colour", params.keyColor, { title: "Colour of the main light, the one that casts the shadows." });
  gui.addSlider("Key Strength", params.keyIntensity, 0, 10, 0.05,
    { title: "How bright the main light is. 0 leaves only the sky light." },
  );
  gui.addSlider("Backlight", params.backlight, 0, 1, 0.01,
    { title: "Swings the main light behind the letters, relative to wherever you are looking. 0 keeps it fixed in the scene; 1 always lights them from behind." },
  );
  gui.addColor("Sky Colour", params.skyColor, { title: "Colour of the light from above, and the top of the backdrop." });
  gui.addColor("Ground Colour", params.groundColor, { title: "Colour of the light from below, and the bottom of the backdrop." });
  gui.addSlider("Sky Strength", params.skyIntensity, 0, 6, 0.05, { title: "How strong that soft overall light is." });
  gui.addSection("Cursor Light");
  gui.addCheckbox("Cursor Light", params.cursorLight,
    { title: "A small light that follows your mouse around the letters." },
  );
  gui.addSlider("Light Strength", params.cursorLightIntensity, 0, 20, 0.1,
    { title: "How bright the cursor light is. 0 turns it off." },
  );
  gui.addSlider("Light Range", params.cursorLightRange, 0.5, 8, 0.05,
    { title: "How far its glow spreads before fading out." },
  );
  gui.addSlider("Light Distance", params.cursorLightOffset, 0, 3, 0.005,
    { title: "How far the light floats in front of the letters. Near 0 it might end up inside one, where it cannot light or shadow that letter's faces." },
  );
  gui.addCheckbox("Light Is Physical", params.lightPhysics,
    { title: "Turns the light sphere into a real object: it collides with the letters and shoves them out of the way instead of passing through." },
  );
  gui.addSlider("Light Mass", params.lightMass, 0.05, 3, 0.01,
    { title: "How heavy the physical light sphere is. Heavier barges through, lighter gets deflected." },
  );
  gui.addSlider("Light Follow", params.lightFollow, 5, 200, 1,
    { title: "How hard the physical sphere chases the cursor. Low values let it lag and swing behind." },
  );
  gui.addColor("Light Colour", params.cursorLightColor, { title: "Colour of the cursor light." });
  gui.addSlider("Light Shadows", params.cursorShadow, 0, 1, 0.01,
    { title: "How dark the shadows the cursor light throws are, on the same scale as Shadow Strength so both lights match. 0 turns them off." },
  );
  gui.addSlider("Shadow Softness", params.cursorShadowSoftness, 0, 1.5, 0.01,
    { title: "How blurry the shadow edges are. 0 gives a hard edge, higher spreads them out like a bigger light would." },
  );
  gui.addSlider("Shadow Rays", params.cursorShadowRays, 1, 8, 1,
    { title: "How many samples the softening uses. More is smoother but costs performance; 1 disables softening." },
  );
  gui.addSlider("Shadow Steps", params.cursorShadowSteps, 0, 32, 1,
    { title: "How carefully each shadow is traced. Higher catches thinner blockers but costs performance." },
  );
  gui.addSlider("Shadow Thickness", params.cursorShadowThickness, 0.25, 6, 0.05,
    { title: "How solid letters count as when blocking the light, as a multiple of their own thickness. Below 1 the shadows thin out and vanish; raise it if they look patchy." },
  );
  gui.addSection("Image");
  gui.addSlider("Exposure", params.exposure, 0.1, 3, 0.01, { title: "Overall brightness of the final image." });

  gui.addTab("Render");
  gui.addCheckbox("Wireframe", params.wireframe,
    { title: "Shows the underlying triangles instead of the solid surface." },
  );
  gui.addSlider("Pixel Ratio", params.pixelRatio, 0.5, 3, 0.05,
    { title: "How many device pixels are rendered per screen pixel. The single biggest cost on high-density screens: 2 is four times the work of 1." },
  );
  gui.addSection("Occlusion");
  gui.addSlider("AO Radius", params.aoRadius, 0, 80, 1, { title: "How far the soft corner shading reaches." });
  gui.addSlider("AO Strength", params.aoStrength, 0, 3, 0.01,
    { title: "How dark it gets where letters meet or fold in on themselves. 0 turns it off." },
  );
  gui.addSlider("AO Bias", params.aoBias, 0, 0.3, 0.005, { title: "Raise this if flat faces look dirty or speckled." });
  gui.addSection("Shadows");
  gui.addSlider("Shadow Strength", params.shadowStrength, 0, 1, 0.01,
    { title: "How dark the main light's shadows are. Matches Light Shadows in the Lighting tab, so both lights sit at the same level." },
  );
  gui.addSlider("Shadow Radius", params.shadowRadius, 0, 16, 0.1,
    { title: "How soft and blurry the shadow edges are." },
  );
  gui.addSlider("Shadow Bias", params.shadowBias, 0, 0.1, 0.001,
    { title: "Raise this if shadows look stripey; too high and they detach from the letters." },
  );
  gui.addSection("Bloom");
  gui.addSlider("Bloom", params.bloom, 0, 2, 0.01, { title: "How much bright areas glow. 0 turns it off." });
  gui.addSlider("Bloom Radius", params.bloomRadius, 0, 1, 0.01,
    { title: "How far the glow spreads, by shifting it between the sharp and the blurry copies. Overall brightness stays the same either way." },
  );
  gui.addSlider("Bloom Threshold", params.bloomThreshold, 0, 2, 0.01,
    { title: "How bright something must be before it glows at all. 0 blooms everything, which can wash out bright surfaces." },
  );

  gui.addSection("Lens");
  gui.addSlider("Fog", params.fogDensity, 0, 0.1, 0.001,
    { title: "How thickly the air fades the letters into the backdrop with distance. 0 turns it off." },
  );
  gui.addSlider("Vignette", params.vignette, 0, 1, 0.01, { title: "Darkens the corners. 0 turns it off." });
  gui.addSlider("Dither", params.dither, 0, 3, 0.05,
    { title: "Breaks up the banding rings in smooth gradients with a touch of noise. 0 turns it off." },
  );
  gui.addSlider("Antialias", params.fxaa, 0, 1, 0.01,
    { title: "Smooths the stair-stepping along letter edges. 0 turns it off, 1 is full strength." },
  );
  gui.addSlider("Specular AA", params.specularAA, 0, 2, 0.01,
    { title: "Stops shiny letters twinkling as they move, by roughening the surface only where it curves too fast for a pixel to follow. Raise it if polished looks shimmer." },
  );
  gui.addSlider("Chromatic", params.chromatic, 0, 80, 1,
    { title: "Spreads the image across the spectrum towards the edges of the frame, in pixels. 0 turns it off." },
  );

  gui.addSection("Motion Blur");
  gui.addSlider("Shutter", params.shutter, 0, 2, 0.01,
    { title: "How much moving letters smear. 0 turns motion blur off." },
  );
  gui.addSlider("Blur Samples", params.blurSamples, 1, 32, 1,
    { title: "Quality of the smear. Higher is smoother but costs performance." },
  );
  gui.addSlider("Max Blur", params.maxBlur, 0, 0.2, 0.002,
    { title: "Caps how long the smear can get, so fast letters don't streak across the screen." },
  );

  gui.addTab("Physics");
  gui.addSection("Simulation");
  gui.addCheckbox("Physics", params.physics, { title: "Lets the letters move and collide. Off holds them still." });
  gui.addSlider("Mass Variation", params.massVariation, 0, 1, 0.01,
    { title: "How much a letter's size affects its weight. Higher makes small letters fly much further." },
  );
  gui.addSlider("Damping", params.damping, 0, 0.9, 0.01,
    { title: "How much drag the air has. 0 lets letters coast forever, high values bring them to a stop almost at once." },
  );
  gui.addSlider("Bounce", params.bounce, 0, 1, 0.01,
    { title: "How much speed survives a collision. 0 makes letters land dead against each other, 1 makes them fully elastic." },
  );
  gui.addSlider("Return Home", params.returnHome, 0, 8, 0.01,
    { title: "How strongly letters are pulled back into place. 0 lets them drift away." },
  );
  gui.addSlider("Return Spin", params.returnSpin, 0, 3, 0.01,
    { title: "How strongly letters turn back the right way up." },
  );
  gui.addSlider("Idle Jiggle", params.idle, 0, 2, 0.01,
    { title: "A slow random wander so the letters never sit perfectly still. 0 leaves them dead." },
  );
  gui.addSection("Interaction");
  gui.addSlider("Hover Nudge", params.hoverStrength, -1, 1, 0.005,
    { title: "How much just moving the mouse disturbs the letters. 0 turns it off, and negative values pull them toward the cursor instead of pushing them away." },
  );
  gui.addSlider("Hover Radius", params.hoverRadius, 0.1, 2, 0.01, { title: "How far that nudge reaches." });
  gui.addSlider("Hold Pull", params.holdPull, 0, 40, 0.1,
    { title: "While you hold the mouse down, how strongly the letters gather onto the light. 0 turns it off." },
  );
  gui.addSlider("Hold Radius", params.holdRadius, 0, 2, 0.01,
    { title: "How tight the gathered bunch packs around the light. 0 crushes them all onto one spot." },
  );
  gui.addSlider("Click Force", params.clickStrength, 0, 40, 0.1, { title: "How hard a click throws the letters." });
  gui.addSlider("Click Radius", params.clickRadius, 0.1, 2, 0.01, { title: "How much of the word a click affects." });
  gui.addSlider("Click Spin", params.clickSpin, 0, 3, 0.01,
    { title: "How much letters tumble when thrown. 0 sends them flying without spinning." },
  );
  gui.addSelect("Force Falloff", params.falloff, [
    ["soft", "Soft"],
    ["sharp", "Sharp"],
    ["point", "Point"],
  ],
    { title: "How the push spreads out. Soft touches everything, Sharp is tighter, Point only hits what's close." },
  );
  gui.addSlider("Click Buildup", params.clickBuildup, 0, 2, 0.01,
    { title: "How much clicking again straight away hits harder." },
  );
  gui.addSlider("Buildup Decay", params.buildupDecay, 0.2, 6, 0.05,
    { title: "How long the extra force lingers, in seconds. Higher keeps it around longer; the build-up tops out at four clicks either way." },
  );
  gui.addSection("Device Tilt", { open: false });
  gui.addSlider("Tilt", params.tilt, 0, 2, 0.05,
    { title: "On a phone, tilting pulls the letters toward whichever edge you lower, like tipping a tray. They slide back when you level it. 0 turns it off, and it does nothing on a machine with no motion sensor." },
  );
  gui.addSlider("Shake Throw", params.tiltShake, 0, 2, 0.05,
    { title: "How hard a sharp shake of the phone throws the letters. 0 turns it off." },
  );
  gui.addSection("Clustering", { open: false });
  gui.addSlider("Cluster Pull", params.cluster, 0, 5, 0.01,
    { title: "How much flying letters bunch together in the middle." },
  );
  gui.addSlider("Cluster Radius", params.clusterRadius, 0.05, 1.5, 0.01, { title: "How tight the bunch gets." });
  gui.addSlider("Cluster Settle", params.clusterSettle, 0, 3, 0.01,
    { title: "How quickly bunching gives way as letters slow down, so they always land back in place." },
  );

  gui.addTab("Sound");
  gui.addSection("Mix");
  gui.addCheckbox("Sound", params.sound,
    { title: "Turns the sound on. Click once first, since browsers won't start audio on their own." },
  );
  gui.addSlider("Volume", params.volume, 0, 2, 0.01, { title: "Overall volume." });
  gui.addSlider("Pause Fade", params.pauseFade, 0, 2, 0.01,
    { title: "How long sound takes to fade out when you pause or switch tabs, and back in when you return. 0 cuts instantly." },
  );
  gui.addSection("Voices");
  gui.addSlider("Swish", params.swishLevel, 0, 2, 0.01, { title: "Volume of the whoosh letters make as they fly." });
  gui.addSlider("Spin Volume", params.spinLevel, 0, 2, 0.01,
    { title: "Volume of the fluttering sound letters make while tumbling." },
  );
  gui.addSlider("Sound Pitch", params.soundTone, 0.3, 2, 0.01,
    { title: "Higher or lower overall tone for the movement sounds." },
  );
  gui.addSlider("Pitch by Size", params.pitchBySize, 0, 1, 0.01,
    { title: "How much bigger letters sound deeper than smaller ones." },
  );
  gui.addSection("Impacts");
  gui.addSlider("Impacts", params.impactLevel, 0, 2, 0.01,
    { title: "Volume of the knocks when letters hit each other." },
  );
  gui.addSlider("Impact Decay", params.impactDecay, 0.05, 2, 0.01, { title: "How long each knock rings out." });
  gui.addSlider("Impact Pitch", params.impactPitch, 0.5, 3, 0.01, { title: "How big and heavy the knocks sound." });
  gui.addSection("Space");
  gui.addSlider("Spatial", params.spatial, 0, 2, 0.01,
    { title: "How much sound follows each letter left and right. 0 keeps it centred, past 1 exaggerates the width." },
  );
  gui.addCheckbox("HRTF Panning", params.hrtf,
    { title: "Richer, more three-dimensional sound. Costs more CPU, so turn it off if audio stutters." },
  );
  gui.addSlider("Doppler", params.doppler, 0, 4, 0.01,
    { title: "How much pitch bends as letters rush towards or away from you. 0 turns it off." },
  );
  gui.addSlider("Reverb", params.reverb, 0, 1, 0.01, { title: "How much room and echo there is." });
  gui.addSlider("Reverb Size", params.reverbSize, 0.3, 8, 0.1, { title: "How big that room feels." });
  gui.addSlider("Light Sphere", params.lightSphere, 0, 2, 0.01,
    { title: "How loudly the light sphere whooshes as you move it. 0 turns it off." },
  );
  gui.addSlider("Drone", params.drone, 0, 2, 0.01,
    { title: "A low background hum that never quite repeats. 0 turns it off." },
  );
  gui.addSlider("Drone Tone", params.droneTone, 0, 2, 0.01,
    { title: "How bright the hum is. Low is a deep rumble, high lets more of it through." },
  );

  gui.addTab("Debug");
  gui.addSection("View");
  gui.addSelect("Buffer", params.debugView, DEBUG_VIEWS,
    { title: "Shows a behind-the-scenes view of how the image is put together." },
  );
  gui.addSection("Physics Overlay");
  gui.addCheckbox("Colliders", params.debugColliders,
    { title: "Outlines the simplified shapes physics actually uses, which are blockier than the letters you see." },
  );
  gui.addCheckbox("Velocity", params.debugVelocity,
    { title: "An arrow on each letter showing which way and how fast it is travelling." },
  );
  gui.addCheckbox("Spin", params.debugSpin,
    { title: "An arrow along the axis each letter is turning around, longer the faster it spins." },
  );
  gui.addCheckbox("Forces", params.debugForces,
    { title: "The pull bringing each letter back towards its place, including the braking that stops it overshooting." },
  );
  gui.addCheckbox("Contacts", params.debugContacts,
    { title: "Marks where letters are hitting each other, bigger for harder knocks." },
  );
  gui.addCheckbox("Home Positions", params.debugHome,
    { title: "Marks where each letter belongs, with a line to where it currently is." },
  );
  gui.addSlider("Arrow Scale", params.debugVectorScale, 0.02, 1, 0.01,
    { title: "Length of the arrows. Turn it down if they clutter the view." },
  );

  gui.addSection("Readouts");
  gui.addCheckbox("Collect Stats", params.showStats,
    { title: "Gathers the numbers below. Turn it off to save a little performance." },
  );

  gui.addSection("Rendering");
  gui.addGraph("FPS", stats.fps, { min: 0, max: 70, below: 30, samples: 120,
    title: "Frames per second. Turns red below 30.",
  });
  gui.addGraph("Frame / Render / ms", [stats.frame, stats.render], {
    min: 0,
    over: 16.7,
    samples: 120,
    title: "Time spent on each frame, and how much of that is drawing. Over 16.7 means under 60fps.",
  });
  gui.addMonitor("Triangles", stats.triangles, { format: fmtInt, title: "Triangles drawn each frame.", });
  gui.addMonitor("Draw calls", stats.calls, { format: fmtInt, over: 60,
    title: "Separate drawing commands sent each frame.",
  });
  gui.addMonitor("Geometries", stats.geometries, { format: fmtInt,
    title: "Shapes currently loaded on the graphics card.",
  });
  gui.addMonitor("Textures", stats.textures, { format: fmtInt,
    title: "Images currently loaded on the graphics card.",
  });
  gui.addMonitor("Programs", stats.programs, { format: fmtInt, title: "Shaders currently compiled.", });
  gui.addMonitor("Last rebuild", stats.build, { format: fmtMs, over: 500,
    title: "How long the letters took to rebuild last time.",
  });

  gui.addSection("Physics");
  gui.addGraph("Step ms", stats.physics, { min: 0, over: 4, samples: 120,
    title: "Time spent working out the physics each frame.",
  });
  gui.addGraph("Mean speed / spin", [stats.speed, stats.spin], {
    min: 0,
    samples: 120,
    title: "How fast the letters are moving and tumbling on average.",
  });
  gui.addGraph("Kinetic energy", stats.energy, { min: 0, samples: 120,
    title: "How much movement is left in the scene. Falls to zero as things settle.",
  });
  gui.addGraph("Contact rate", stats.contacts, { min: 0, samples: 120, title: "Collisions happening right now.", });
  gui.addMonitor("Bodies awake", stats.awake, { format: fmtInt, title: "Letters still moving.", });
  gui.addMonitor("Bodies", stats.bodies, { format: fmtInt, title: "Letters in the simulation.", });
  gui.addMonitor("Manifolds", stats.manifolds, { format: fmtInt,
    title: "Letters currently touching, including gentle brushes too soft to hear.",
  });
  gui.addMonitor("Hardest hit", stats.impulse, { format: fmt3, title: "How hard the last collision was.", });
  gui.addMonitor("Max drift", stats.drift, { format: fmt3,
    title: "How far the furthest letter is from where it belongs.",
  });

  gui.addSection("Audio");
  gui.addGraph("Update ms", stats.audio, { min: 0, over: 2, samples: 120,
    title: "Time spent updating the sound each frame.",
  });
  gui.addGraph("Sound squash", [stats.limiter, stats.impactComp], {
    min: 0,
    over: 12,
    samples: 120,
    title: "How much the sound is being squashed. If the first number stays high, knocks are drowning out everything else.",
  });
  gui.addGraph("Swish level", stats.swish, { min: 0, samples: 120,
    title: "How loud the loudest whoosh is right now.",
  });
  gui.addMonitor("Context", stats.info, { title: "Audio status, quality and reverb length." });
  gui.addMonitor("Voices", stats.voices, { format: fmtInt, title: "Letters currently making a sound.", });
  gui.addMonitor("Output latency", stats.latency, { format: fmtMs,
    title: "Delay before sound reaches your speakers.",
  });

  return gui;
}

export { buildPanel };
