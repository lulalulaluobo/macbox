import { createServer } from 'vite';

let configuration = { failureName: '', failureMode: 'http', delayMs: 0 };
const requests = [];
const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
};
const json = (response, body, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};
const server = await createServer({ server: { port: 19819, strictPort: true, host: '127.0.0.1' }, plugins: [{
  name: 'upload-ui-test', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://127.0.0.1:19819');
      if (url.pathname === '/__upload_test__') {
        response.setHeader('Content-Type', 'text/html');
        response.end(await server.transformIndexHtml('/__upload_test__', '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/upload-ui-test-entry.tsx"></script></body></html>'));
      } else if (url.pathname === '/__upload_test__/state') {
        json(response, { requests, configuration });
      } else if (url.pathname === '/__upload_test__/configure') {
        configuration = { failureName: '', failureMode: 'http', delayMs: 0, ...JSON.parse((await readBody(request)).toString() || '{}') };
        requests.length = 0;
        json(response, configuration);
      } else if (url.pathname === '/api/terminal/files/upload') {
        const body = await readBody(request);
        const relativePath = url.searchParams.get('relativePath');
        const failed = configuration.failureName && relativePath?.includes(configuration.failureName);
        requests.push({ operation: 'upload', targetDir: url.searchParams.get('targetDir'), relativePath, bodyBytes: body.length, failed: Boolean(failed) });
        if (configuration.delayMs) await new Promise((resolve) => setTimeout(resolve, configuration.delayMs));
        if (failed && configuration.failureMode === 'network') request.socket.destroy();
        else json(response, failed ? { error: '测试：文件写入失败' } : { status: 'success' }, failed ? 500 : 200);
      } else if (url.pathname === '/api/terminal/files/mkdir') {
        const body = JSON.parse((await readBody(request)).toString());
        requests.push({ operation: 'mkdir', ...body });
        json(response, { status: 'success' });
      } else next();
    });
  },
}] });
await server.listen();
console.log('上传界面测试入口：http://127.0.0.1:19819/__upload_test__（仅假 API，无真实文件写入）');
const stop = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
