#!/usr/bin/env node
/**
 * 用 CDP 驱动无头 Chrome 做「交互式截图」。
 *
 * 用途：校对那些必须先操作才会出现的界面状态（例如跑完一次诊断后的时间线）。
 * 纯静态截图看不到这些状态，所以需要真的点一下按钮。
 *
 * 用法（需先手动启动带调试端口的 Chrome）：
 *   node scripts/shoot.mjs <url> <out.png> ["js;js;js..."]
 *
 * 说明：用 Node 22 内置的 WebSocket，不引入 puppeteer。
 */

const [, , url, out, actions = ''] = process.argv;
if (!url || !out) {
  console.error('用法: node shoot.mjs <url> <out.png> ["js;js;js"]');
  process.exit(1);
}

/** 调试端口可由 CDP_PORT 覆盖 —— Windows 的保留端口段会让 bind() 报 0x271D */
const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? 9333}`;

/** 轮询拿到一个 page 类型的 target */
async function findTarget(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`${CDP}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* Chrome 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('找不到可用的 CDP page target');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(msg.error.message));
      else p.res(msg.result);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await findTarget();
const cdp = await connect(target.webSocketDebuggerUrl);

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

// 视口固定为设计稿尺寸
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

await cdp.send('Page.navigate', { url });
await sleep(2500);

for (const js of actions.split(';').map((s) => s.trim()).filter(Boolean)) {
  const r = await cdp.send('Runtime.evaluate', { expression: js, awaitPromise: true });
  if (r.exceptionDetails) console.error('  动作报错:', r.exceptionDetails.text);
  await sleep(1200);
}

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const { writeFile } = await import('node:fs/promises');
await writeFile(out, Buffer.from(shot.data, 'base64'));

console.log(`✓ ${out}`);
cdp.close();
