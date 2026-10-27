const { desktopCapturer, screen } = require('electron');
const frames = require('./frames');

// Captures the display the cursor is currently on and returns { jpeg, fp }:
// a JPEG Buffer plus a tiny fingerprint used to detect an unchanged screen.
// The image only ever lives in memory: it is written nowhere, so a screenshot
// flagged as sensitive is "deleted" simply by being dropped.
async function captureScreen(maxWidth = 1600) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = display.scaleFactor || 1;
  const size = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture the screen.');

  let img = source.thumbnail;
  if (img.getSize().width > maxWidth) img = img.resize({ width: maxWidth, quality: 'good' });
  const small = img.resize({ width: frames.W, height: frames.H, quality: 'good' });
  return { jpeg: img.toJPEG(70), fp: frames.fingerprint(small.toBitmap()) };
}

module.exports = { captureScreen };
