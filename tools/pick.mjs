#!/usr/bin/env node
/*
 * pick.mjs  Start your own project from ONE of the ten designs.
 *
 *   node tools/pick.mjs 09-card-tree ../my-agent-view
 *   node tools/pick.mjs --list
 *
 * Creates a standalone folder you own:
 *   my-agent-view/index.html  proto.js  proto.css     <- the design (edit these)
 *   my-agent-view/shared/                              <- event model, player, UI shell, adapter server
 *   my-agent-view/package.json                         <- `npm start` serves it on http://127.0.0.1:7777
 * No build step, no dependencies. The result keeps the SIMULATED badge until you feed it real events.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const protos = fs.readdirSync(path.join(ROOT, 'prototypes')).filter((d) => /^\d\d-/.test(d)).sort();
const args = process.argv.slice(2);
if (args[0] === '--list' || args.length < 2) {
  console.log('Designs:\n  ' + protos.filter((p) => p !== '00-template').join('\n  ') + '\n\nusage: node tools/pick.mjs <design> <new-folder>');
  process.exit(args[0] === '--list' ? 0 : 1);
}
const [name, destArg] = args;
const src = path.join(ROOT, 'prototypes', name);
if (!fs.existsSync(src)) { console.error(`Unknown design "${name}". Run: node tools/pick.mjs --list`); process.exit(1); }
const dest = path.resolve(destArg);
if (fs.existsSync(dest) && fs.readdirSync(dest).length) { console.error(`${dest} already exists and is not empty.`); process.exit(1); }
fs.mkdirSync(path.join(dest, 'shared'), { recursive: true });

const sharedFiles = ['core.js', 'chrome.js', 'theme.css', 'scenario.js', 'stress.js', 'scenario.json', 'adapter-server.mjs', 'README.md', 'claude-code-hooks.example.json'];
for (const f of sharedFiles) fs.copyFileSync(path.join(ROOT, 'shared', f), path.join(dest, 'shared', f));
for (const f of fs.readdirSync(src)) {
  let s = fs.readFileSync(path.join(src, f), 'utf8');
  if (f === 'index.html') s = s.replaceAll('../../shared/', './shared/');
  if (f === 'README.md') s = s.replace(/node \S*shared\/adapter-server\.mjs/g, 'node shared/adapter-server.mjs').replace(/prototypes\/[\w-]+\//g, '');
  fs.writeFileSync(path.join(dest, f === 'README.md' ? 'DESIGN-NOTES.md' : f), s);
}
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: path.basename(dest), version: '0.1.0', private: true, type: 'module', scripts: { start: 'node shared/adapter-server.mjs' } }, null, 2) + '\n');
fs.writeFileSync(path.join(dest, 'README.md'), `# ${path.basename(dest)}

Started from the **${name}** design of Agent Activity Lab.

\`\`\`bash
npm start        # or: node shared/adapter-server.mjs
# open http://127.0.0.1:7777/   (index.html also opens straight from disk)
\`\`\`

- Edit \`proto.js\` / \`proto.css\` to change the design. \`DESIGN-NOTES.md\` explains how it encodes states, delegation, messages and outputs, plus its known limits.
- \`shared/\` is the event model and UI shell. \`shared/README.md\` documents the events and the live adapter (\`POST /event\`, \`POST /claude-hook\`, \`POST /replay\`).
- Everything is **simulated** until you send real events. The badge in the header says so and the shell will not let a design hide it.
`);
console.log(`Created ${dest}\n  cd ${destArg} && npm start   ->  http://127.0.0.1:7777/`);
