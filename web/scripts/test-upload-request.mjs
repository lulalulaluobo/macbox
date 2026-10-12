import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/api/upload.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { uploadFileRequest } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const success = () => Response.json({ status: 'success' });
const android = () => Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Android' }, configurable: true });
let calls = 0;
const file = new File(['video bytes'], '视频.mp4', { type: 'video/mp4' });

try {
  android();
  globalThis.fetch = async (_url, options) => {
    calls++;
    const part = options.body.get('file');
    assert.equal(part.name, '视频.mp4');
    assert.equal(await part.text(), 'video bytes');
    return success();
  };
  assert.deepEqual(await uploadFileRequest('/upload', file), { status: 'success' });
  assert.equal(calls, 1);

  calls = 0;
  let readCount = 0;
  const providerFile = new File(['video bytes'], '视频.mp4');
  providerFile.arrayBuffer = async () => { readCount++; return new TextEncoder().encode('video bytes').buffer; };
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) throw new TypeError('Failed to fetch');
    assert.equal(await options.body.get('file').text(), 'video bytes');
    return success();
  };
  await uploadFileRequest('/upload', providerFile);
  assert.equal(calls, 2);
  assert.equal(readCount, 1);

  calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: '当前已有多个文件在上传，请稍后重试' }, { status: 429 }); };
  await assert.rejects(uploadFileRequest('/upload', providerFile), /当前已有多个文件/);
  assert.equal(calls, 1, 'HTTP failures must not retry');
  assert.equal(readCount, 1, 'HTTP failures must not read the file');

  globalThis.fetch = async () => new Response('<html>proxy error</html>', { status: 502 });
  await assert.rejects(uploadFileRequest('/upload', file), /HTTP 502/);

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const unreadableFile = new File(['x'], 'unreadable.txt');
  unreadableFile.arrayBuffer = async () => { throw new DOMException('Unreadable', 'NotReadableError'); };
  await assert.rejects(uploadFileRequest('/upload', unreadableFile), /浏览器无法读取/);

  const oversizedFile = new File(['x'], 'large.mp4');
  Object.defineProperty(oversizedFile, 'size', { value: 129 * 1024 * 1024 });
  oversizedFile.arrayBuffer = async () => { assert.fail('oversized file must not be materialized'); };
  await assert.rejects(uploadFileRequest('/upload', oversizedFile), /上传连接失败/);

  calls = 0;
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Desktop' }, configurable: true });
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  await assert.rejects(uploadFileRequest('/upload', file), /上传连接失败/);
  assert.equal(calls, 1);

  console.log('上传请求测试通过：文件名、安卓有界重试、读取失败、HTTP不重试、代理错误、大文件内存限制。');
} finally {
  globalThis.fetch = originalFetch;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
}
