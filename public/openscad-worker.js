// Renders OpenSCAD source to an OFF mesh inside a Web Worker, so the UI never freezes.
import OpenSCAD from './scad/openscad.js';

self.onmessage = async (e) => {
  // format 'off' feeds the live preview (it carries per-face colour); 'binstl' is what
  // people actually send to a slicer, exported by OpenSCAD itself rather than converted.
  const { code, requestId, format = 'off' } = e.data;
  if (typeof code !== 'string') return;

  const stderr = [];

  try {
    // A fresh instance per render, deliberately.
    //
    // OpenSCAD's main() calls exit(), which tears down the Emscripten runtime, so an
    // instance can only ever run once — reusing it throws "program has already aborted!"
    // and every render after the first fails. noExitRuntime doesn't save it either.
    // Instantiating costs ~30ms against a render of 250ms+, so this is a cheap fix.
    const openscad = await OpenSCAD({
      noInitialRun: true,
      print: () => {},
      printErr: (text) => {
        // Manifold chatters on stderr during normal operation; not useful to anyone.
        if (text.includes('Manifold constructor') || text.includes('Manifold: ')) return;
        stderr.push(text);
      },
    });

    openscad.FS.writeFile('/input.scad', code);

    const stl = format === 'binstl';
    const outputPath = stl ? '/output.stl' : '/output.off';

    openscad.callMain([
      '/input.scad',
      '-o',
      outputPath,
      '--backend=manifold',
      `--export-format=${stl ? 'binstl' : 'off'}`,
    ]);

    const warnings = stderr.filter((line) => line.includes('WARNING:'));

    if (stl) {
      const bytes = openscad.FS.readFile(outputPath, { encoding: 'binary' });
      self.postMessage({ requestId, stl: bytes, warnings }, [bytes.buffer]);
    } else {
      const off = openscad.FS.readFile(outputPath, { encoding: 'utf8' });
      self.postMessage({ requestId, off, warnings });
    }

    // No cleanup needed: the whole instance is discarded with this message.
  } catch (err) {
    const detail =
      stderr.filter((line) => line.includes('ERROR:') || line.includes('WARNING:')).join('\n') ||
      stderr.join('\n') ||
      (err && err.message) ||
      'Something went wrong while building the shape.';
    self.postMessage({ requestId, error: detail });
  }
};
