import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const server = await createServer({ server: { port: 19818, strictPort: true, host: '127.0.0.1' }, plugins: [{
  name: 'remote-ui-test', configureServer(server) {
    server.middlewares.use('/__remote_test__', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/__remote_test__', '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/remote-ui-test-entry.tsx"></script></body></html>'));
    });
  },
}] });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let current = { installed: false, state: 'notInstalled', message: '开启后可在外面访问应用和后台', consoleReady: false, busy: false };
let job = null;
const actions = [];
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (!path.startsWith('/api/')) { await route.continue(); return; }
  let response = {};
  if (path === '/api/remote/tailscale') response = current;
  else if (path.startsWith('/api/remote/tailscale/')) {
    const action = path.split('/').pop(); actions.push(action);
    job = { id: 'test-job', kind: `remote.${action}`, status: 'running', message: '正在处理' };
    current = { ...current, busy: true }; response = { jobId: job.id };
  } else if (path === '/api/jobs') response = { jobs: job ? [job] : [] };
  else if (path === '/api/jobs/test-job') response = job;
  else if (path === '/api/apps') response = [{ id: 'test', name: '测试应用', installed: true, status: 'running', port: 8092, webUrl: 'http://192.168.2.68:8092' }];
  else if (path === '/api/service-shortcuts') response = { shortcuts: [
    { id: 'manual', source: 'manual', name: '命令服务', url: 'http://192.168.2.68:3000/path?q=1', enabled: true },
    { id: 'external', source: 'manual', name: '外部网站', url: 'https://example.com', enabled: true },
  ] };
  else if (path === '/api/vm/network') response = { ip: '192.168.2.68' };
  await route.fulfill({ json: response });
});
const reload = async state => { current = { ...current, busy: false, ...state }; job = null; await page.reload(); };
try {
  await page.goto('http://127.0.0.1:19818/__remote_test__');
  await page.getByRole('button', { name: '开启访问', exact: true }).click();
  await page.getByRole('button', { name: '开启访问', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '开启访问', exact: true }).isDisabled(), true);
  assert.deepEqual(actions, ['install']);
  job.status = 'succeeded';
  current = { ...current, installed: true, state: 'needsLogin', authURL: 'https://login.tailscale.com/a/ui-fixture', busy: false, message: '请登录账号，授权这台设备' };
  await page.getByRole('button', { name: '刷新状态' }).click();
  const login = page.getByRole('link', { name: '登录账号' }); await login.waitFor();
  assert.equal(await login.getAttribute('href'), current.authURL);
  assert.equal(await login.getAttribute('rel'), 'noopener noreferrer');
  await reload({ state: 'needsApproval', authURL: undefined, message: '请在Tailscale后台批准这台设备' });
  await page.getByRole('link', { name: '批准设备' }).waitFor();
  await reload({ state: 'connected', ip: '100.100.0.2', deviceName: 'macbox', networkName: '测试网络', consoleReady: true, consoleURL: 'http://100.100.0.2:19808', message: '已连接，获准的设备可以访问' });
  await page.getByText('测试应用', { exact: true }).waitFor();
  assert.equal(await page.locator('a[href="http://100.100.0.2:8092/"]').count(), 1);
  assert.equal(await page.locator('a[href="http://100.100.0.2:3000/path?q=1"]').count(), 1);
  assert.equal(await page.getByText('外部网站', { exact: true }).count(), 0);
  await page.getByLabel('其他服务').fill('65536'); assert.equal(await page.getByText('服务入口', { exact: true }).count(), 0);
  await page.getByLabel('其他服务').fill('8080'); assert.equal(await page.locator('a[href="http://100.100.0.2:8080"]').count(), 1);
  await mkdir('../artifacts', { recursive: true });
  await page.screenshot({ path: '../artifacts/tailscale-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: '../artifacts/tailscale-settings-mobile.png', fullPage: true });
  const cancel = dialog => dialog.dismiss(); page.once('dialog', cancel);
  await page.getByRole('button', { name: '暂停访问' }).click(); assert.deepEqual(actions, ['install']);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '暂停访问' }).click();
  assert.deepEqual(actions, ['install', 'pause']);
  await reload({ state: 'paused', consoleReady: false, consoleURL: undefined, message: '远程访问已暂停，登录仍保留' });
  await page.getByRole('button', { name: '恢复访问' }).waitFor();
  await reload({ state: 'expired', authURL: 'https://login.tailscale.com/a/ui-fixture', message: '登录已过期，请重新授权' });
  await page.getByRole('link', { name: '登录账号' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('远程访问界面通过：安装去重、授权、待批准、入口、暂停确认、过期、小屏布局。');
} catch (error) { console.error({ errors, visible: (await page.locator('body').innerText()).slice(0,250) }); throw error; }
finally { await browser.close(); await server.close(); }
