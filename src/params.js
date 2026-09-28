// Parameter definitions, templates and validation.
// Pure data + arithmetic: no CAD kernel here, so the UI can import it cheaply.

export const PARAM_DEFS = [
  { group: "shape",  key: "length",        min: 30,  max: 110, step: 0.5, unit: "mm" },
  { group: "shape",  key: "width",         min: 8,   max: 40,  step: 0.5, unit: "mm" },
  { group: "shape",  key: "baseThickness", min: 4,   max: 16,  step: 0.5, unit: "mm" },
  { group: "shape",  key: "tipThickness",  min: 1.5, max: 12,  step: 0.5, unit: "mm" },
  { group: "shape",  key: "cornerRadius",  min: 0,   max: 6,   step: 0.5, unit: "mm" },
  { group: "tip",    key: "hook",          min: 0,   max: 10,  step: 0.5, unit: "mm" },
  { group: "tip",    key: "hookLength",    min: 3,   max: 20,  step: 0.5, unit: "mm" },
  { group: "grip",   key: "ribCount",      min: 0,   max: 16,  step: 1,   unit: ""   },
  { group: "grip",   key: "ribPitch",      min: 1.5, max: 6,   step: 0.25, unit: "mm" },
  { group: "grip",   key: "ribDepth",      min: 0.2, max: 2,   step: 0.1, unit: "mm" },
  { group: "grip",   key: "ribStart",      min: 2,   max: 40,  step: 0.5, unit: "mm" },
  { group: "mount",  key: "holeDia",       min: 2,   max: 6,   step: 0.1, unit: "mm" },
  { group: "mount",  key: "holeCount",     min: 0,   max: 3,   step: 1,   unit: ""   },
  { group: "mount",  key: "holeSpacing",   min: 6,   max: 24,  step: 0.5, unit: "mm" },
  { group: "mount",  key: "holeOffset",    min: 4,   max: 30,  step: 0.5, unit: "mm" },
];

export const DEFAULTS = {
  length: 70, width: 16, baseThickness: 9, tipThickness: 4, cornerRadius: 1.5,
  hook: 0, hookLength: 8,
  ribCount: 0, ribPitch: 3, ribDepth: 0.8, ribStart: 6,
  holeDia: 3.4, holeCount: 2, holeSpacing: 12, holeOffset: 10,
};

export const TEMPLATES = {
  flat:   { ...DEFAULTS },
  ribbed: { ...DEFAULTS, ribCount: 8, ribPitch: 3, ribDepth: 0.8, ribStart: 6 },
  hook:   { ...DEFAULTS, length: 76, tipThickness: 3, cornerRadius: 1.3, hook: 4, hookLength: 9,
            ribCount: 4, ribStart: 16 },
  needle: { ...DEFAULTS, length: 90, width: 10, tipThickness: 2, cornerRadius: 0.8 },
  wide:   { ...DEFAULTS, length: 60, width: 30, tipThickness: 6, cornerRadius: 2.5,
            ribCount: 10, ribPitch: 3.5, ribDepth: 1, ribStart: 6 },
};

// Keep values inside a range that the solid kernel can always build.
export function sanitize(raw) {
  const p = { ...DEFAULTS, ...raw };
  for (const d of PARAM_DEFS) {
    const v = Number(p[d.key]);
    p[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : DEFAULTS[d.key];
  }
  p.ribCount = Math.round(p.ribCount);
  p.holeCount = Math.round(p.holeCount);
  p.tipThickness = Math.min(p.tipThickness, p.baseThickness);
  p.hookLength = Math.min(p.hookLength, p.length * 0.4);
  return p;
}

// The corner radius can't exceed half the thinnest section.
export function effectiveRadius(p) {
  const r = Math.min(p.cornerRadius, p.tipThickness / 2 - 0.15, p.width / 2 - 0.2);
  return r >= 0.2 ? r : 0;
}

// What actually got built, for the summary panel.
export function describe(p) {
  const ribsTop = p.length - p.ribStart;
  const ribsBottom = ribsTop - (p.ribCount - 1) * p.ribPitch;
  return {
    radius: effectiveRadius(p),
    ribsFit: p.ribCount === 0 || ribsBottom > p.holeOffset + p.holeSpacing * Math.max(p.holeCount - 1, 0) + p.holeDia,
    holesFit: p.holeCount === 0 ||
      p.holeOffset + p.holeSpacing * (p.holeCount - 1) < p.length - p.hookLength,
  };
}

