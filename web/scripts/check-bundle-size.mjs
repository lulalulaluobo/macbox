import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsDir = new URL('../dist/assets/', import.meta.url);
const assetsPath = fileURLToPath(assetsDir);
const maxGzipBytes = 180 * 1024;
const files = (await readdir(assetsDir)).filter((file) => file.endsWith('.js'));

if (files.length === 0) {
  console.error('未找到生产 JavaScript chunk，请先运行 npm run build');
  process.exit(1);
}

let failed = false;
for (const file of files.sort()) {
  const content = await readFile(join(assetsPath, file));
  const gzipBytes = gzipSync(content, { level: 9 }).length;
  const rawKB = (content.length / 1024).toFixed(1);
  const gzipKB = (gzipBytes / 1024).toFixed(1);
  const status = gzipBytes > maxGzipBytes ? 'FAIL' : ' OK ';
  console.log(`${status} ${file}: ${rawKB} KB raw, ${gzipKB} KB gzip`);
  if (gzipBytes > maxGzipBytes) failed = true;
}

if (failed) {
  console.error(`\n存在超过 ${maxGzipBytes / 1024} KB gzip 门槛的 JavaScript chunk`);
  process.exit(1);
}

console.log(`\n全部 JavaScript chunk 均不超过 ${maxGzipBytes / 1024} KB gzip`);
