#!/usr/bin/env node
// TEST DOUBLE for the Claude Code CLI. It speaks the stream-json format so the service can be tested without a login.
// It is NOT Claude and never used unless AGENT_LAB_CLAUDE_BIN points at it; sessions it runs are labelled TEST STUB.
import fs from 'node:fs';
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('0.0.0-test-stub'); process.exit(0); }
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: process.env.STUB_LOGGED_OUT ? false : true, authMethod: 'stub' })); process.exit(0); }
const out = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let prompt = ''; process.stdin.setEncoding('utf8'); for await (const c of process.stdin) prompt += c;
if (/FAIL_AUTH/.test(prompt)) { process.stderr.write('Failed to authenticate: OAuth session expired and could not be refreshed\n'); process.exit(1); }
out({ type: 'system', subtype: 'init', session_id: 'stub-session', model: 'stub-model', cwd: process.cwd(), tools: ['Read', 'Write', 'Bash', 'Agent'] });
const asst = (content, parent = null) => out({ type: 'assistant', message: { role: 'assistant', content }, parent_tool_use_id: parent, session_id: 'stub-session' });
const user = (content, parent = null) => out({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: parent, session_id: 'stub-session' });
if (/SLOW/.test(prompt)) { asst([{ type: 'text', text: 'Working slowly.' }]); await sleep(60000); process.exit(0); }
asst([{ type: 'text', text: 'I will split this: a subagent inspects the data while I write the script.' }]); await sleep(150);
asst([{ type: 'tool_use', id: 'toolu_sub1', name: 'Agent', input: { subagent_type: 'data-inspector', description: 'Inspect sample.csv columns' } }, { type: 'tool_use', id: 'toolu_w1', name: 'Write', input: { file_path: process.cwd() + '/sample.csv', content: 'a,b\n1,2\n3,4\n' } }]); await sleep(100);
fs.writeFileSync('sample.csv', 'a,b\n1,2\n3,4\n');
user([{ type: 'tool_result', tool_use_id: 'toolu_w1', content: 'File created', is_error: false }]);
asst([{ type: 'tool_use', id: 'toolu_r1', name: 'Read', input: { file_path: process.cwd() + '/sample.csv' } }], 'toolu_sub1'); await sleep(200);
user([{ type: 'tool_result', tool_use_id: 'toolu_r1', content: 'a,b 1,2 3,4', is_error: false }], 'toolu_sub1');
asst([{ type: 'tool_use', id: 'toolu_f1', name: 'WebFetch', input: { url: 'https://example.com' } }], 'toolu_sub1'); await sleep(100);
user([{ type: 'tool_result', tool_use_id: 'toolu_f1', content: "Claude requested permissions to use WebFetch, but you haven't granted it yet.", is_error: true }], 'toolu_sub1'); await sleep(100);
asst([{ type: 'tool_use', id: 'toolu_r2', name: 'Read', input: { file_path: process.cwd() + '/sample.csv' } }], 'toolu_sub1'); await sleep(100);
user([{ type: 'tool_result', tool_use_id: 'toolu_r2', content: 'a,b 1,2 3,4', is_error: false }], 'toolu_sub1');
user([{ type: 'tool_result', tool_use_id: 'toolu_sub1', content: [{ type: 'text', text: 'Two numeric columns, a and b, two rows.' }], is_error: false }]);
asst([{ type: 'tool_use', id: 'toolu_w2', name: 'Write', input: { file_path: process.cwd() + '/analyze_csv.py', content: "import csv,sys\nrows=list(csv.DictReader(open(sys.argv[1])))\nprint(len(rows),'rows')\n" } }]); await sleep(100);
fs.writeFileSync('analyze_csv.py', "import csv,sys\nrows=list(csv.DictReader(open(sys.argv[1])))\nprint(len(rows),'rows')\n");
user([{ type: 'tool_result', tool_use_id: 'toolu_w2', content: 'File created', is_error: false }]);
asst([{ type: 'tool_use', id: 'toolu_b1', name: 'Bash', input: { command: 'python3 analyze_csv.py missing.csv' } }]); await sleep(120);
user([{ type: 'tool_result', tool_use_id: 'toolu_b1', content: 'FileNotFoundError: missing.csv', is_error: true }]);
asst([{ type: 'tool_use', id: 'toolu_b2', name: 'Bash', input: { command: 'python3 analyze_csv.py sample.csv' } }]); await sleep(150);
fs.writeFileSync('summary.txt', '2 rows\n');
user([{ type: 'tool_result', tool_use_id: 'toolu_b2', content: '2 rows', is_error: false }]);
out({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1500, num_turns: 4, result: 'Created analyze_csv.py and ran it: 2 rows.', total_cost_usd: 0.0123, session_id: 'stub-session', permission_denials: [{ tool_name: 'WebFetch', tool_use_id: 'toolu_f1', tool_input: { url: 'https://example.com' } }] });
