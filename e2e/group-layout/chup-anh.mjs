import { createRequire } from 'node:module';
const require = createRequire('/Users/hoangphuc01975/Documents/developers/codexis-ide/package.json');
const { chromium } = require('@playwright/test');

const [width, height, out, scenario] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5] ?? 'single'];

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width, height } });
const unknown = new Set();
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('pageerror:', (e.stack||String(e)).slice(0, 600)));
await page.exposeFunction('__log', (c) => unknown.add(c));
await page.addInitScript((scenario) => {
  const ROOT = '/demo/project';
  const diff = Array.from({ length: 60 }, (_, i) => `line ${i} ` + 'long text '.repeat(i % 7 === 0 ? 40 : 3)).join('\n');
  const diffNew = diff;
  const handlers = {
    auth_status: () => [{ provider: 'claude', installed: true, loggedIn: true, account: 'a@b.c', details: [] }, { provider: 'codex', installed: true, loggedIn: false, account: null, details: [] }, { provider: 'github', installed: true, loggedIn: true, account: 'x', details: [] }],
    workspace_info: () => ({ name: 'demo', root: ROOT }),
    workspace_tree: () => ({ paths: ['src/a.ts', 'src/b.ts', 'README.md'], truncated: false }),
    settings_get: () => ({ avatar:'', userName:'u', assistantName:'a', voice:'', customInstructions:'', defaultCli:'claude', claudeModel:'', codexModel:'', claudePlan:'', codexPlan:'', fallbackEnabled:false, fallbackOrder:['claude','codex'], language:'vi', appearance:'light', codeColors:'' }),
    chat_grid_get: () => scenario.startsWith('group') ? Array.from({ length: Number(scenario.slice(5, 6)) }, (_, i) => ({ group: 1, workspace: ROOT, conversation: i + 1, title: 'Chat ' + (i + 1) })) : [],
    chat_list: () => [1,2,3,4].map((id) => ({ id, title: 'Chat ' + id, updatedAt: 1760000000, turns: 1 })),
    chat_load: (a) => ({ workspace: ROOT, conversation: a?.conversation ?? 1, turns: [], sessions: {} }),
    local_head: (a) => ({ path: a?.path, content: 'old\n'.repeat(5), exists: true }),
    workspace_read: () => ({ content: diffNew, hash: 'h' }),
    local_changes: () => ({ git: true, files: [{ path: 'src/a.ts', status: 'modified', added: 3, removed: 1 }] }),
    window_is_fullscreen: () => false,
    projects_list: () => ({ projects: [{ id: '1', name: 'demo', folders: [ROOT], env: [] }], selected: '1' }),
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    convertFileSrc: (p) => p,
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    unregisterCallback: () => {},
    invoke: async (cmd, args) => {
      if (cmd in handlers) return handlers[cmd](args);
      if (cmd.startsWith('plugin:event|')) return 0;
      window.__log(cmd);
      return [];
    },
  };
  if (scenario.endsWith('wide')) { localStorage.setItem('ai-chat.width.changes', '1400'); localStorage.setItem('ai-chat.width.file', '1200'); }
  window.__scenario = scenario;
}, scenario);
await page.goto('http://localhost:1420/');
await page.waitForTimeout(3000);
if (scenario.startsWith('group')) { await page.getByText('Nhóm 1').first().click(); await page.waitForTimeout(1500); }
if (scenario.endsWith('wide')) { await page.mouse.click(width - 155, 23); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
console.log('unknown commands:', [...unknown].join(', '));
await browser.close();
