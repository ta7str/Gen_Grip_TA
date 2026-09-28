// Runs the CAD kernel off the main thread so sliders stay smooth while
// OpenCascade rebuilds the solid (a rebuild takes 0.1 to 1.5 s).
import opencascade from "replicad-opencascadejs";
import { setOC } from "replicad";
import { buildFinger } from "./finger.js";
import { sanitize, describe } from "./params.js";

const cache = new Map();            // slot -> { key, shape }
let ready = false;

async function init() {
  const OC = await opencascade({
    locateFile: (file) => new URL(file, self.location.href).href,
  });
  setOC(OC);
  ready = true;
  self.postMessage({ type: "ready" });
}

function solidFor(slot, params) {
  const p = sanitize(params);
  const key = JSON.stringify(p);
  const hit = cache.get(slot);
  if (hit && hit.key === key) return { p, shape: hit.shape };
  const shape = buildFinger(p);
  cache.set(slot, { key, shape });
  return { p, shape };
}

function meshStats(position, index) {
  let vol = 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
    const ax = position[a], ay = position[a + 1], az = position[a + 2];
    const bx = position[b], by = position[b + 1], bz = position[b + 2];
    const cx = position[c], cy = position[c + 1], cz = position[c + 2];
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(vol) / 6;         // mm^3
}

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  try {
    if (!ready) throw new Error("CAD engine is not ready yet");

    if (cmd === "build") {
      const { p, shape } = solidFor(data.slot, data.params);
      const m = shape.mesh({ tolerance: 0.04, angularTolerance: 0.25 });
      const position = Float32Array.from(m.vertices);
      const normal = Float32Array.from(m.normals);
      const index = Uint32Array.from(m.triangles);
      const bb = shape.boundingBox;
      self.postMessage({
        id, ok: true,
        mesh: { position, normal, index },
        stats: {
          size: [bb.bounds[1][0] - bb.bounds[0][0], bb.bounds[1][1] - bb.bounds[0][1], bb.bounds[1][2] - bb.bounds[0][2]],
          volume: meshStats(position, index),
          notes: describe(p),
        },
      }, [position.buffer, normal.buffer, index.buffer]);
      return;
    }

    if (cmd === "export") {
      const { shape } = solidFor(data.slot, data.params);
      const blob = data.format === "step"
        ? shape.blobSTEP()
        : shape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.08 });
      const buf = await blob.arrayBuffer();
      self.postMessage({ id, ok: true, data: buf }, [buf]);
      return;
    }

    throw new Error("unknown command: " + cmd);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};

init().catch((err) => self.postMessage({ type: "fatal", error: String(err && err.message || err) }));
