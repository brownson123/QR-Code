// Self-host the zxing-cpp WebAssembly used by barcode-detector (S5b decision), so the scanner never
// loads code from a CDN. Copied from node_modules on predev/prebuild; public/zxing/ is gitignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const fromBarcodeDetector = createRequire(require.resolve('barcode-detector'));
// The exact wasm build barcode-detector depends on (zxing-wasm exports it as a subpath).
const source = fromBarcodeDetector.resolve('zxing-wasm/reader/zxing_reader.wasm');
const target = join(process.cwd(), 'public', 'zxing', 'zxing_reader.wasm');
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copied ${source} -> public/zxing/zxing_reader.wasm`);
