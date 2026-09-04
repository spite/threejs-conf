const DEBUG_VIEWS = [
  ["beauty", "Beauty"],
  ["albedo", "Albedo"],
  ["normals", "Normals"],
  ["position", "Position"],
  ["depth", "Depth"],
  ["ao", "Occlusion"],
  ["shadow", "Shadow"],
  ["velocity", "Velocity"],
  ["cursorlight", "Cursor Light"],
  ["cursorshadow", "Cursor Shadow"],
];

const debugViewIndex = new Map(DEBUG_VIEWS.map(([key], i) => [key, i]));

const debugViewName = (key) => `VIEW_${key.toUpperCase()}`;

const debugViewDefines = DEBUG_VIEWS.map(
  ([key], i) => `#define ${debugViewName(key)} ${i}`,
).join("\n");

export { DEBUG_VIEWS, debugViewIndex, debugViewDefines };
