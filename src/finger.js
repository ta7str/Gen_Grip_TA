// Parametric gripper finger, built as a real B-rep solid with replicad
// (OpenCascade compiled to WebAssembly). The same solid feeds the preview
// mesh, the STL export and the STEP export, so all three always agree.
//
// Coordinates (mm):  +Z runs from the mount end up to the tip,
//                    X = 0 is the gripping face (the object sits at +X),
//                    the body grows toward -X, Y is the finger width.
import { draw, makeCylinder } from "replicad";
import { sanitize, effectiveRadius } from "./params.js";

function profile(p) {
  const { length: L, baseThickness: tb, tipThickness: tt, hook, hookLength: hl } = p;
  const pen = draw([0, 0]);
  if (hook > 0) {
    pen.lineTo([0, L - hl]).lineTo([hook, L - hl * 0.55]).lineTo([hook, L]);
  } else {
    pen.lineTo([0, L]);
  }
  return pen.lineTo([-tt, L]).lineTo([-tb, 0]).close();
}

export function buildFinger(input) {
  const p = sanitize(input);
  const { width: W, length: L } = p;

  // 1. side profile, extruded across the width and centred on Y = 0
  let body = profile(p).sketchOnPlane("XZ").extrude(W);
  const bb = body.boundingBox;
  body = body.translate([0, -bb.center[1], 0]);

  // 2. rounded corners: plan-view corners along the length, then the tip edge
  const r = effectiveRadius(p);
  if (r > 0) {
    for (const k of [1, 0.6, 0.3]) {           // retry smaller if the kernel refuses
      try {
        body = body.fillet(r * k, (e) => e.not((f) => f.inPlane("XY", 0)));
        break;
      } catch { /* try the next size */ }
    }
  }

  // 3. V-grooves on the gripping face, cut in one pass with a sawtooth profile
  if (p.ribCount > 0) {
    const groove = p.ribPitch * 0.85;          // leaves a small flat land between grooves
    const zs = [];
    for (let i = 0; i < p.ribCount; i++) {
      const z = L - p.ribStart - i * p.ribPitch;
      if (z - groove / 2 < 1) break;
      zs.push(z);
    }
    zs.reverse();                               // build from the bottom up
    if (zs.length) {
      const pen = draw([0, zs[0] - groove / 2]);
      zs.forEach((z, i) => {
        pen.lineTo([-p.ribDepth, z]).lineTo([0, z + groove / 2]);
        if (i < zs.length - 1) pen.lineTo([0, zs[i + 1] - groove / 2]);
      });
      const top = zs[zs.length - 1] + groove / 2;
      const cutter = pen.lineTo([1, top]).lineTo([1, zs[0] - groove / 2]).close()
        .sketchOnPlane("XZ").extrude(W + 4)
        .translate([0, (W + 4) / 2, 0]);
      body = body.cut(cutter);
    }
  }

  // 4. mount holes, straight through the thickness
  for (let i = 0; i < p.holeCount; i++) {
    const z = p.holeOffset + i * p.holeSpacing;
    if (z > L - 2) break;
    const hole = makeCylinder(p.holeDia / 2, p.baseThickness + p.hook + 4,
      [-p.baseThickness - 2, 0, z], [1, 0, 0]);
    body = body.cut(hole);
  }

  return body;
}
