import { initLumora } from './packages/core/src/runtime.ts';
import os from 'os';
import path from 'path';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';

const root = await mkdtemp(path.join(os.tmpdir(), 'lumora-audit-'));
const routesDir = path.join(root, 'routes');
await mkdir(routesDir, { recursive: true });
await writeFile(path.join(routesDir, 'post.ts'), 'export default { kind: "resource", resource: "post", fields: { title: { type: "string", required: true } }, audit: true };');
const dbPath = path.join(root, 'test.db');

const lumora = await initLumora({
  name: 'fixture',
  mode: 'production',
  api: { base: '/api', version: 'v1' },
  auth: { mode: 'static', token: 'secret' },
  database: { client: 'sqlite', url: `sqlite://${dbPath}` },
  routes: { dir: routesDir }
});

console.log("ROUTES:", lumora.app.routes.map(r => `${r.method} ${r.path}`));

const res = await lumora.app.request('/api/v1/post', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'authorization': 'Bearer secret' },
  body: JSON.stringify({ title: 'Audit me' })
});

console.log("STATUS:", res.status);
console.log("BODY:", await res.text());

await lumora.close();
