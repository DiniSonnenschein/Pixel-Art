// Baut src/ zu www/app.js. Die Versionsnummer kommt aus APP_VERSION (CI) oder "dev".
import * as esbuild from 'esbuild';

const version = process.env.APP_VERSION || 'dev';
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: 'chrome90',
  outfile: 'www/app.js',
  sourcemap: true,
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'info',
};

if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
