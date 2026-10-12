import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/pages/storage/filemanager/uploadEntries.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { normalizeUploadPath, joinUploadTarget, selectionFromFiles, emptyUploadDirectories, captureUploadDrop, selectionFromDrop } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const makeFile = (name, relativePath = '') => {
  const file = new File(['data'], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
};
const fileEntry = (name) => ({ name, isFile: true, isDirectory: false, file: (success) => success(makeFile(name)) });
const directoryEntry = (name, batches) => ({
  name, isFile: false, isDirectory: true,
  createReader: () => {
    let cursor = 0;
    return { readEntries: (success) => success(batches[cursor++] || []) };
  },
});

assert.equal(normalizeUploadPath('项目/第 1 章/片段.mp4'), '项目/第 1 章/片段.mp4');
assert.equal(joinUploadTarget('/data/', '项目/片段.mp4'), '/data/项目/片段.mp4');
assert.equal(joinUploadTarget('/', '文件夹'), '/文件夹');
for (const invalid of ['', '/absolute/file', '../escape', 'root/../escape', 'root/./file', 'root//file', 'root\\file', 'root/\u0000file']) {
  assert.throws(() => normalizeUploadPath(invalid), /相对路径无效/);
}

const fileSelection = selectionFromFiles([
  makeFile('a.txt', '选定根目录/子目录/a.txt'),
  makeFile('b.txt', '选定根目录/b.txt'),
]);
assert.deepEqual(fileSelection.files.map((item) => item.relativePath), ['选定根目录/子目录/a.txt', '选定根目录/b.txt']);
assert.deepEqual(fileSelection.directories, ['选定根目录', '选定根目录/子目录']);
assert.deepEqual(emptyUploadDirectories(fileSelection), [], 'Nonempty directories are safely created by the file upload API');
assert.equal(selectionFromFiles([makeFile('single.txt')]).files[0].relativePath, 'single.txt');
assert.throws(() => selectionFromFiles([makeFile('flattened.txt')], true), /未提供文件夹路径/);

let readCalls = 0;
const manyFiles = Array.from({ length: 205 }, (_, i) => fileEntry(`file-${i}.txt`));
const root = directoryEntry('拖入根目录', [manyFiles.slice(0, 100), manyFiles.slice(100, 200), manyFiles.slice(200), [
  directoryEntry('空目录', []),
  directoryEntry('嵌套目录', [[fileEntry('nested.txt'), directoryEntry('嵌套空目录', [])]]),
]]);
const originalCreateReader = root.createReader;
root.createReader = () => {
  const reader = originalCreateReader();
  return { readEntries: (success, failure) => { readCalls += 1; reader.readEntries(success, failure); } };
};
const manySelection = await selectionFromDrop({ entries: [root], files: [], unreadable: false });
assert.equal(readCalls, 5, 'readEntries must continue through every batch and stop only on an empty batch');
assert.equal(manySelection.files.length, 206);
assert.equal(manySelection.files.at(-1).relativePath, '拖入根目录/嵌套目录/nested.txt');
assert.deepEqual(manySelection.directories, ['拖入根目录', '拖入根目录/空目录', '拖入根目录/嵌套目录', '拖入根目录/嵌套目录/嵌套空目录']);
assert.deepEqual(emptyUploadDirectories(manySelection), ['拖入根目录/空目录', '拖入根目录/嵌套目录/嵌套空目录']);
assert.deepEqual(emptyUploadDirectories({ files: [], directories: ['空根目录', '空根目录/空子目录'] }), ['空根目录/空子目录']);

const snapshots = captureUploadDrop({ items: [
  { kind: 'file', webkitGetAsEntry: () => root },
  { kind: 'file', getAsFile: () => makeFile('普通文件.txt') },
  { kind: 'string', getAsFile: () => { throw new Error('Non-file drag items must not be read'); } },
], files: [] });
const combined = await selectionFromDrop(snapshots);
assert.equal(combined.files.length, 207);
assert.equal(combined.files[0].relativePath, '普通文件.txt');
assert.deepEqual(captureUploadDrop({ items: [], files: [makeFile('fallback.txt')] }).files.map((file) => file.name), ['fallback.txt']);
await assert.rejects(selectionFromDrop({ entries: [], files: [], unreadable: true }), /无法读取拖入的文件夹/);
await assert.rejects(selectionFromDrop({ entries: [{ name: '无法读取.txt', isFile: true, isDirectory: false, file: (_success, failure) => failure(new DOMException('read denied', 'NotReadableError')) }], files: [], unreadable: false }), /无法读取“无法读取.txt”/);

console.log('上传目录测试通过：路径校验、根目录保留、205 项分批遍历、嵌套/空目录、同步拖放快照、兼容回退与读取失败。');
