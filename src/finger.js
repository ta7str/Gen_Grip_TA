// Parametric gripper finger, built as a real B-rep solid with replicad
// (OpenCascade compiled to WebAssembly). The same solid feeds the preview
// mesh, the STL export and the STEP export, so all three always agree.
//
// Coordinates (mm):  +Z runs from the mount end up to the tip,
//                    X = 0 is the gripping face (the object sits at +X),
//                    the body grows toward -X, Y is the finger width.
import { draw, makeCylinder } from "replicad";
import { sanitize, effectiveRadius, skinArc, arcPt } from "./params.js";

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
  if (p.structure === "finray") return buildFinRay(p);
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


// Fin Ray finger: straight spine (the gripping face), a thin curved skin, and
// slanted webs between them. The side profile is cut through the full width.
function buildFinRay(p) {
  const { length: L, width: W, baseThickness: tb, tipThickness: tt, hook, hookLength: hl } = p;
  const st = p.skinThickness, sp = p.spineThickness, N = p.webCount;
  const a = skinArc(p);
  const centre = (shape) => shape.translate([0, -shape.boundingBox.center[1], 0]);
  const extrudeSide = (pen, depth) => centre(pen.sketchOnPlane("XZ").extrude(depth));

  // 1. outer envelope: spine face, barb at the tip, skin arc, mount end
  const env = draw([0, 0]);
  if (hook > 0.05) env.lineTo([0, L - hl]).lineTo([hook, L - hl]);
  const envelope = env.lineTo([0, L]).lineTo([-tt, L])
     .threePointsArcTo(arcPt(a, a.R, 0), arcPt(a, a.R, a.alpha / 2))
     .lineTo([-tb, 0]).close();
  let body = extrudeSide(envelope, W);

  // 2. hollow region between spine and skin, from the mount block to where
  //    the inner skin meets the spine
  const ri = a.R - st;
  const thC = Math.min(Math.acos(Math.min(1, (a.cx + sp) / ri)), a.alpha * 0.995);
  const pB = arcPt(a, ri, thC);
  const zc = pB[1];
  const void2d = draw([-sp, a.cz]).lineTo([-sp, pB[1]]);
  if (Math.abs(pB[0] + sp) > 1e-6) void2d.lineTo(pB);
  const voidShape = void2d.threePointsArcTo(arcPt(a, ri, 0), arcPt(a, ri, thC / 2)).close();
  let cavity = extrudeSide(voidShape, W + 4);

  // 3. webs stay behind: subtract them from the hollow before cutting it
  const half = p.webThickness / 2, reach = tb + 6;
  for (let i = 0; i < N; i++) {
    const z = a.cz + ((i + 1) * (zc - a.cz)) / (N + 1);
    const phi = ((N > 1 ? i / (N - 1) : 0) * p.webSlant * Math.PI) / 180;
    const u = [-Math.cos(phi), Math.sin(phi)];       // from spine toward skin, leaning to the tip
    const n = [Math.sin(phi), Math.cos(phi)];
    const s0 = [-sp - u[0] * 1, z - u[1] * 1];
    const s1 = [-sp + u[0] * reach, z + u[1] * reach];
    const web = draw([s0[0] + n[0] * half, s0[1] + n[1] * half])
      .lineTo([s1[0] + n[0] * half, s1[1] + n[1] * half])
      .lineTo([s1[0] - n[0] * half, s1[1] - n[1] * half])
      .lineTo([s0[0] - n[0] * half, s0[1] - n[1] * half]).close();
    cavity = cavity.cut(extrudeSide(web, W + 8));
  }
  body = body.cut(cavity);

  // 4. mount holes: across the thickness of the block, through the width
  for (let i = 0; i < p.holeCount; i++) {
    const x = -tb / 2 + (i - (p.holeCount - 1) / 2) * p.holeSpacing;
    body = body.cut(makeCylinder(p.holeDia / 2, W + 4, [x, -W / 2 - 2, p.mountLength / 2], [0, 1, 0]));
  }
  return body;
}
