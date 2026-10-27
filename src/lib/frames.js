// Cheap "has the screen changed?" check so an unchanged screen doesn't pay for
// another multi-minute local-model run.

const W = 160;
const H = 90;
const PIXEL_DELTA = 24; // luma levels a pixel must move to count as changed
const MAX_CHANGED = 0.002; // fraction of pixels allowed to differ and still count as "same"

// bitmap: BGRA buffer of a W x H image (nativeImage.toBitmap()).
function fingerprint(bitmap) {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = (bitmap[o] * 29 + bitmap[o + 1] * 150 + bitmap[o + 2] * 77) >> 8;
  }
  return out;
}

function similar(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > PIXEL_DELTA) changed++;
  return changed / a.length <= MAX_CHANGED;
}

module.exports = { W, H, fingerprint, similar };
