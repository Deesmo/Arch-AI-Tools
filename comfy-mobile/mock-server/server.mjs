#!/usr/bin/env node
/**
 * Mock ComfyUI server for developing / demoing Comfy Mobile without a GPU.
 *
 *   npm run mock                      # http://0.0.0.0:8188
 *   PORT=8189 npm run mock
 *   MOCK_ALL_NODES=1 npm run mock     # also expose the AnimateDiff / VHS custom nodes
 *   MOCK_NO_CORS=1 npm run mock       # omit CORS headers (to test the app's CORS diagnosis)
 *   MOCK_FAIL=1 npm run mock          # every 3rd prompt fails with an execution_error
 *
 * Implements the subset of the ComfyUI HTTP + WebSocket API the app uses:
 *   GET  /system_stats /object_info /object_info/:t /models /models/:f /queue /history /history/:id /view /prompt /features /embeddings /extensions
 *   GET  /userdata?dir=workflows&recurse=true[&full_info=true]  /userdata/:file   (served from mock-server/userdata/)
 *   POST /prompt /queue /history /interrupt /upload/image
 *   WS   /ws?clientId=…  status, execution_start, executing, progress, binary preview frames, executed, execution_success|error
 *
 * Execution is simulated: nodes run in id order, sampler nodes emit progress +
 * JPEG preview frames, and output nodes (SaveImage / SaveVideo / VHS_VideoCombine)
 * produce the bundled fixtures (mp4 / gif / png) in the right history shape.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { join, dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { buildObjectInfo, MODELS } from './object-info.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures');
const INPUT_DIR = join(here, '.input');
/** Mirrors ComfyUI's per-user `user/default/` tree; `workflows/` holds what the web UI's "Save" writes. */
const USERDATA_DIR = resolve(here, 'userdata');
mkdirSync(INPUT_DIR, { recursive: true });

const PORT = Number(process.env.PORT ?? 8188);
const NO_CORS = process.env.MOCK_NO_CORS === '1';
const FAIL_EVERY_3RD = process.env.MOCK_FAIL === '1';
const SPEED = Number(process.env.MOCK_SPEED ?? 1); // >1 = faster

const OBJECT_INFO = buildObjectInfo();
const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

// ---- state -----------------------------------------------------------------
const clients = new Map(); // clientId -> Set<ws>
const history = {}; // promptId -> entry
const pending = []; // [number, promptId, prompt, extra, outputs]
let running = null;
let counter = 0;
let promptCount = 0;
const uploads = new Map(); // filename -> Buffer
const uploadedNames = [];

// ---- helpers ---------------------------------------------------------------
function cors(res) {
  if (NO_CORS) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Comfy-User, Authorization, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
}
function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function text(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}
/** Resolves a user-data relative path inside USERDATA_DIR, or null when it escapes it. */
function safeUserdataPath(rel) {
  const abs = resolve(USERDATA_DIR, rel.replace(/\\/g, '/'));
  return abs === USERDATA_DIR || abs.startsWith(USERDATA_DIR + sep) ? abs : null;
}
function listFiles(dir, recurse) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recurse) out.push(...listFiles(abs, true));
    } else out.push(abs);
  }
  return out;
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
function broadcast(obj, clientId) {
  const data = JSON.stringify(obj);
  const targets = clientId ? [clients.get(clientId) ?? new Set()] : [...clients.values()];
  for (const set of targets) for (const ws of set) if (ws.readyState === 1) ws.send(data);
}
function broadcastBinary(buf, clientId) {
  const targets = clientId ? [clients.get(clientId) ?? new Set()] : [...clients.values()];
  for (const set of targets) for (const ws of set) if (ws.readyState === 1) ws.send(buf);
}
function sendStatus() {
  broadcast({ type: 'status', data: { status: { exec_info: { queue_remaining: pending.length + (running ? 1 : 0) } } } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));

function queueTuple(item) {
  return [item.number, item.promptId, item.prompt, item.extra, item.outputs];
}

/** Serve a file with byte-range support (needed for <video> seeking on iOS). */
function serveFile(req, res, path) {
  cors(res);
  if (!existsSync(path)) {
    res.writeHead(404);
    return res.end('not found');
  }
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(path).pipe(res);
}

// ---- simulated execution ---------------------------------------------------
function outputsFor(type, node, index) {
  const stamp = String(counter).padStart(5, '0');
  if (type === 'SaveVideo') {
    const prefix = String(node.inputs.filename_prefix ?? 'video/ComfyUI');
    const subfolder = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    const base = prefix.slice(prefix.lastIndexOf('/') + 1);
    return { images: [{ filename: `${base}_${stamp}_.mp4`, subfolder, type: 'output' }] };
  }
  if (type === 'VHS_VideoCombine') {
    const prefix = String(node.inputs.filename_prefix ?? 'AnimateDiff');
    const fmt = String(node.inputs.format ?? 'image/gif');
    const ext = fmt.includes('mp4') ? 'mp4' : fmt.includes('webm') ? 'webm' : fmt.includes('webp') ? 'webp' : 'gif';
    return { gifs: [{ filename: `${prefix}_${stamp}.${ext}`, subfolder: '', type: 'output', format: fmt, frame_rate: Number(node.inputs.frame_rate ?? 8), workflow: `${prefix}_${stamp}.png`, fullpath: `/output/${prefix}_${stamp}.${ext}` }] };
  }
  if (type === 'SaveImage' || type === 'PreviewImage') {
    const prefix = String(node.inputs.filename_prefix ?? 'ComfyUI');
    const batch = Math.max(1, Math.min(4, Number(index) || 1));
    return {
      images: Array.from({ length: batch }, (_, i) => ({ filename: `${prefix}_${String(counter * 10 + i).padStart(5, '0')}_.png`, subfolder: '', type: type === 'PreviewImage' ? 'temp' : 'output' })),
    };
  }
  return null;
}

function fixtureFor(filename) {
  const ext = extname(filename).toLowerCase();
  if (ext === '.mp4' || ext === '.webm') return join(FIX, 'sample.mp4');
  if (ext === '.gif' || ext === '.webp') return join(FIX, 'sample.gif');
  if (ext === '.jpg' || ext === '.jpeg') return join(FIX, 'preview.jpg');
  return join(FIX, 'sample.png');
}

async function runPrompt(item) {
  running = item;
  const { promptId, prompt, extra } = item;
  const clientId = extra?.client_id;
  const started = Date.now();
  const ids = Object.keys(prompt).sort((a, b) => Number(a) - Number(b));
  const messages = [['execution_start', { prompt_id: promptId, timestamp: started }]];
  const outputs = {};
  sendStatus();
  broadcast({ type: 'execution_start', data: { prompt_id: promptId, timestamp: started } }, clientId);
  broadcast({ type: 'execution_cached', data: { nodes: [], prompt_id: promptId, timestamp: started } }, clientId);
  messages.push(['execution_cached', { nodes: [], prompt_id: promptId, timestamp: started }]);

  const shouldFail = FAIL_EVERY_3RD && promptCount % 3 === 0;
  const previewJpeg = readFileSync(join(FIX, 'preview.jpg'));
  let batch = 1;
  for (const id of ids) {
    if (item.interrupted) break;
    const node = prompt[id];
    const type = node.class_type;
    broadcast({ type: 'executing', data: { node: id, display_node: id, prompt_id: promptId } }, clientId);
    const isSampler = /KSampler|SamplerCustom/.test(type);
    const isLoader = /Loader/.test(type);
    if (type === 'EmptyLatentImage') batch = Number(node.inputs.batch_size ?? 1);
    if (!OBJECT_INFO[type]) {
      item.error = { node_id: id, node_type: type, exception_message: `Cannot execute because node ${type} does not exist.`, exception_type: 'KeyError' };
      break;
    }
    if (shouldFail && isSampler) {
      item.error = { node_id: id, node_type: type, exception_message: 'CUDA out of memory. Tried to allocate 2.00 GiB (simulated failure, MOCK_FAIL=1)', exception_type: 'torch.OutOfMemoryError' };
      break;
    }
    if (isSampler) {
      const steps = Math.max(1, Math.min(60, Number(node.inputs.steps ?? 20)));
      for (let s = 1; s <= steps; s++) {
        if (item.interrupted) break;
        await sleep(90);
        broadcast({ type: 'progress', data: { value: s, max: steps, prompt_id: promptId, node: id } }, clientId);
        if (s % 2 === 0) {
          const header = Buffer.alloc(8);
          header.writeUInt32BE(1, 0); // PREVIEW_IMAGE
          header.writeUInt32BE(1, 4); // JPEG
          broadcastBinary(Buffer.concat([header, previewJpeg]), clientId);
        }
      }
    } else {
      await sleep(isLoader ? 350 : 120);
    }
    const out = outputsFor(type, node, batch);
    if (out) {
      outputs[id] = out;
      broadcast({ type: 'executed', data: { node: id, display_node: id, output: out, prompt_id: promptId } }, clientId);
    }
  }

  const finished = Date.now();
  let status;
  if (item.error) {
    const err = { prompt_id: promptId, node_id: item.error.node_id, node_type: item.error.node_type, executed: Object.keys(outputs), exception_message: item.error.exception_message, exception_type: item.error.exception_type, traceback: ['Traceback (most recent call last):', '  File "execution.py", line 42, in execute', `${item.error.exception_type}: ${item.error.exception_message}`], current_inputs: {}, current_outputs: {}, timestamp: finished };
    broadcast({ type: 'execution_error', data: err }, clientId);
    messages.push(['execution_error', err]);
    status = { status_str: 'error', completed: false, messages };
  } else if (item.interrupted) {
    broadcast({ type: 'execution_interrupted', data: { prompt_id: promptId, node_id: ids[0], node_type: '', executed: Object.keys(outputs), timestamp: finished } }, clientId);
    messages.push(['execution_interrupted', { prompt_id: promptId, timestamp: finished }]);
    status = { status_str: 'error', completed: false, messages };
  } else {
    broadcast({ type: 'executing', data: { node: null, prompt_id: promptId } }, clientId);
    broadcast({ type: 'execution_success', data: { prompt_id: promptId, timestamp: finished } }, clientId);
    messages.push(['execution_success', { prompt_id: promptId, timestamp: finished }]);
    status = { status_str: 'success', completed: true, messages };
  }
  history[promptId] = { prompt: queueTuple(item), outputs, status, meta: {} };
  running = null;
  sendStatus();
  void pump();
}

let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  while (pending.length) {
    const item = pending.shift();
    await runPrompt(item);
  }
  pumping = false;
}

// ---- HTTP ------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api(?=\/)/, '');
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(NO_CORS ? 403 : 204);
    return res.end();
  }
  const log = `${req.method} ${path}${url.search}`;

  try {
    if (req.method === 'GET' && path === '/') {
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>ComfyUI (mock)</title><h1>Comfy Mobile mock ComfyUI server</h1>');
    }
    if (req.method === 'GET' && path === '/system_stats') {
      return json(res, 200, {
        system: { os: 'nt', ram_total: 68719476736, ram_free: 51539607552, comfyui_version: '0.3.60-mock', required_frontend_version: '1.28.8', python_version: '3.12.7', pytorch_version: '2.8.0+cu128', embedded_python: false, argv: ['main.py', '--listen', '0.0.0.0', '--enable-cors-header'] },
        devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 5090 : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 34359738368, vram_free: 31138512896, torch_vram_total: 2147483648, torch_vram_free: 1073741824 }],
      });
    }
    if (req.method === 'GET' && path === '/object_info') return json(res, 200, OBJECT_INFO);
    if (req.method === 'GET' && path.startsWith('/object_info/')) {
      const t = decodeURIComponent(path.slice('/object_info/'.length));
      return json(res, 200, OBJECT_INFO[t] ? { [t]: OBJECT_INFO[t] } : {});
    }
    if (req.method === 'GET' && path === '/models') return json(res, 200, Object.keys(MODELS));
    if (req.method === 'GET' && path.startsWith('/models/')) {
      const folder = decodeURIComponent(path.slice('/models/'.length));
      return json(res, 200, MODELS[folder] ?? []);
    }
    if (req.method === 'GET' && path === '/embeddings') return json(res, 200, MODELS.embeddings.map((f) => f.replace(/\.[^.]+$/, '')));
    // User data (app/user_manager.py): GET /userdata?dir=…&recurse=true[&full_info=true] lists files,
    // GET /userdata/{file} serves one (the whole relative path is a single URL-encoded segment).
    if (req.method === 'GET' && path === '/userdata') {
      const dir = url.searchParams.get('dir') ?? '';
      if (!dir) return text(res, 400, 'Directory not provided');
      const root = safeUserdataPath(dir);
      if (!root) return text(res, 403, 'Invalid directory');
      if (!existsSync(root) || !statSync(root).isDirectory()) return text(res, 404, 'Directory not found');
      const recurse = url.searchParams.get('recurse') === 'true';
      const fullInfo = url.searchParams.get('full_info') === 'true';
      const files = listFiles(root, recurse).map((abs) => {
        const rel = relative(root, abs).split(sep).join('/');
        if (!fullInfo) return rel;
        const st = statSync(abs);
        return { path: rel, size: st.size, modified: Math.round(st.mtimeMs) };
      });
      return json(res, 200, files);
    }
    if (req.method === 'GET' && path.startsWith('/userdata/')) {
      const file = safeUserdataPath(decodeURIComponent(path.slice('/userdata/'.length)));
      if (!file) return text(res, 403, 'Invalid file');
      if (!existsSync(file) || !statSync(file).isFile()) return text(res, 404, 'File not found');
      cors(res);
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff' });
      return createReadStream(file).pipe(res);
    }
    if (req.method === 'GET' && path === '/extensions') return json(res, 200, []);
    if (req.method === 'GET' && path === '/features') return json(res, 200, { supports_preview_metadata: true, max_upload_size: 104857600 });
    if (req.method === 'GET' && path === '/queue') {
      return json(res, 200, { queue_running: running ? [queueTuple(running)] : [], queue_pending: pending.map(queueTuple) });
    }
    if (req.method === 'GET' && path === '/prompt') return json(res, 200, { exec_info: { queue_remaining: pending.length + (running ? 1 : 0) } });
    if (req.method === 'GET' && path === '/history') {
      const max = Number(url.searchParams.get('max_items') ?? 200);
      const entries = Object.entries(history).slice(-max);
      return json(res, 200, Object.fromEntries(entries));
    }
    if (req.method === 'GET' && path.startsWith('/history/')) {
      const id = path.slice('/history/'.length);
      return json(res, 200, history[id] ? { [id]: history[id] } : {});
    }
    if (req.method === 'GET' && path === '/view') {
      const filename = url.searchParams.get('filename') ?? '';
      const type = url.searchParams.get('type') ?? 'output';
      if (type === 'input') {
        if (uploads.has(filename)) {
          cors(res);
          const buf = uploads.get(filename);
          res.writeHead(200, { 'Content-Type': MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': buf.length });
          return res.end(buf);
        }
        return serveFile(req, res, existsSync(join(FIX, filename)) ? join(FIX, filename) : join(FIX, 'example.png'));
      }
      return serveFile(req, res, fixtureFor(filename));
    }

    if (req.method === 'POST' && path === '/prompt') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const prompt = body.prompt ?? {};
      // Validate like ComfyUI: unknown class types and missing required inputs.
      const nodeErrors = {};
      for (const [id, node] of Object.entries(prompt)) {
        const defn = OBJECT_INFO[node.class_type];
        if (!defn) {
          nodeErrors[id] = { errors: [{ type: 'invalid_prompt', message: `Cannot execute because node ${node.class_type} does not exist.`, details: `Node ID '#${id}'`, extra_info: {} }], dependent_outputs: [], class_type: node.class_type };
          continue;
        }
        for (const [name, spec] of Object.entries(defn.input.required ?? {})) {
          if (node.inputs[name] === undefined) {
            nodeErrors[id] = nodeErrors[id] ?? { errors: [], dependent_outputs: [], class_type: node.class_type };
            nodeErrors[id].errors.push({ type: 'required_input_missing', message: 'Required input is missing', details: name, extra_info: { input_name: name } });
          } else if (Array.isArray(spec[0]) && typeof node.inputs[name] === 'string' && !spec[0].includes(node.inputs[name]) && !(name === 'image' && uploads.has(node.inputs[name]))) {
            nodeErrors[id] = nodeErrors[id] ?? { errors: [], dependent_outputs: [], class_type: node.class_type };
            nodeErrors[id].errors.push({ type: 'value_not_in_list', message: 'Value not in list', details: `${name}: '${node.inputs[name]}' not in [${spec[0].slice(0, 3).map((s) => `'${s}'`).join(', ')}${spec[0].length > 3 ? ', …' : ''}]`, extra_info: { input_name: name, received_value: node.inputs[name] } });
          }
        }
      }
      if (Object.keys(nodeErrors).length) {
        console.log(log, '-> 400 (validation)');
        return json(res, 400, { error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: '', extra_info: {} }, node_errors: nodeErrors });
      }
      const outputNodes = Object.entries(prompt).filter(([, n]) => OBJECT_INFO[n.class_type]?.output_node).map(([id]) => id);
      if (outputNodes.length === 0) {
        return json(res, 400, { error: { type: 'prompt_no_outputs', message: 'Prompt has no outputs', details: '', extra_info: {} }, node_errors: {} });
      }
      counter += 1;
      promptCount += 1;
      const promptId = randomUUID();
      const item = { number: counter, promptId, prompt, extra: { ...(body.extra_data ?? {}), client_id: body.client_id }, outputs: outputNodes };
      if (body.front) pending.unshift(item);
      else pending.push(item);
      sendStatus();
      void pump();
      console.log(log, `-> queued #${counter} (${Object.keys(prompt).length} nodes)`);
      return json(res, 200, { prompt_id: promptId, number: counter, node_errors: {} });
    }
    if (req.method === 'POST' && path === '/queue') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (body.clear) pending.length = 0;
      for (const id of body.delete ?? []) {
        const i = pending.findIndex((p) => p.promptId === id);
        if (i >= 0) pending.splice(i, 1);
      }
      sendStatus();
      return json(res, 200, {});
    }
    if (req.method === 'POST' && path === '/history') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (body.clear) for (const k of Object.keys(history)) delete history[k];
      for (const id of body.delete ?? []) delete history[id];
      return json(res, 200, {});
    }
    if (req.method === 'POST' && path === '/interrupt') {
      if (running) running.interrupted = true;
      return json(res, 200, {});
    }
    if (req.method === 'POST' && path === '/upload/image') {
      const buf = await readBody(req);
      const ct = req.headers['content-type'] ?? '';
      const boundary = /boundary=(.+)$/.exec(ct)?.[1];
      let name = `upload_${Date.now()}.png`;
      let data = buf;
      if (boundary) {
        // Minimal multipart parse: find the "image" part.
        const parts = buf.toString('latin1').split(`--${boundary}`);
        for (const part of parts) {
          const m = /name="image"; filename="([^"]*)"/.exec(part);
          if (!m) continue;
          name = m[1].replace(/[^\w.\-]+/g, '_') || name;
          const idx = part.indexOf('\r\n\r\n');
          data = Buffer.from(part.slice(idx + 4, part.lastIndexOf('\r\n')), 'latin1');
        }
      }
      uploads.set(name, data);
      if (!uploadedNames.includes(name)) uploadedNames.push(name);
      writeFileSync(join(INPUT_DIR, name), data);
      // Make the new file selectable in LoadImage combos, like real ComfyUI does after refresh.
      const li = OBJECT_INFO.LoadImage?.input.required.image;
      if (li && !li[0].includes(name)) li[0].push(name);
      console.log(log, `-> stored ${name} (${data.length} bytes)`);
      return json(res, 200, { name, subfolder: '', type: 'input' });
    }

    console.log(log, '-> 404');
    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(log, err);
    json(res, 500, { error: String(err) });
  }
});

// ---- WebSocket -------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws' && url.pathname !== '/api/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const clientId = url.searchParams.get('clientId') ?? randomUUID();
    if (!clients.has(clientId)) clients.set(clientId, new Set());
    clients.get(clientId).add(ws);
    ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: pending.length + (running ? 1 : 0) } }, sid: clientId } }));
    console.log(`WS connect ${clientId}`);
    ws.on('close', () => {
      clients.get(clientId)?.delete(ws);
      console.log(`WS close ${clientId}`);
    });
  });
});

server.listen(PORT, process.env.HOST ?? '0.0.0.0', () => {
  const addr = server.address();
  console.log(`Mock ComfyUI listening on http://${addr.address}:${addr.port}  (nodes: ${Object.keys(OBJECT_INFO).length}, CORS: ${NO_CORS ? 'OFF' : 'on'}, fail: ${FAIL_EVERY_3RD ? 'every 3rd' : 'off'})`);
});
