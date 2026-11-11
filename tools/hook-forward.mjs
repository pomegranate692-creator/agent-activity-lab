#!/usr/bin/env node
/*
 * hook-forward.mjs  Claude Code hook command: forwards the hook payload (stdin JSON) to the Agent Activity Lab adapter.
 *
 *   node tools/hook-forward.mjs [--url http://127.0.0.1:7777] [--log /path/raw.jsonl]
 *
 * Safety: prints NOTHING and always exits 0, so it can never block, approve, deny or alter a Claude Code action
 * (hook stdout/exit codes are how hooks influence Claude Code). Gives up after 1.5 s. If the adapter is not running it
 * silently does nothing. --log additionally appends the raw payload to a local file (off by default; payloads can contain
 * prompts, file paths and commands, and stay on this machine).
 */
import http from 'node:http';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const url = new URL('/claude-hook', opt('url', process.env.AGENT_LAB_URL || 'http://127.0.0.1:7777'));
const logFile = opt('log', process.env.AGENT_LAB_LOG || '');

let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { if (body.length < 2_000_000) body += d; });
process.stdin.on('end', () => {
  if (!body.trim()) process.exit(0);
  if (logFile) { try { fs.appendFileSync(logFile, body.replace(/\n/g, ' ').trim() + '\n'); } catch {} }
  const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 1500 }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.end(body);
  setTimeout(() => process.exit(0), 1800).unref();
});
process.stdin.on('error', () => process.exit(0));
