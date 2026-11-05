import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function acquireServerLock(outputRoot, port, options = {}) {
  const baseDir = options.baseDir || os.tmpdir();
  const pid = options.pid || process.pid;
  const pidAlive = options.pidAlive || processAlive;
  const key = crypto.createHash('sha256').update(path.resolve(outputRoot)).digest('hex').slice(0, 20);
  const file = path.join(baseDir, `prototype-talk-${key}.lock`);
  const owner = { pid, port, output_root: path.resolve(outputRoot), token: crypto.randomUUID() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(file, 'utf8')).token === owner.token) fs.rmSync(file);
        } catch { /* a stale or replaced lock belongs to another process */ }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous = null;
      try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* interrupted or corrupt lock */ }
      if (previous?.pid && pidAlive(previous.pid)) throw new Error(`此评审目录已有 Prototype Talk 服务运行在 127.0.0.1:${previous.port}（进程 ${previous.pid}）。请复用或先停止该服务。`);
      try { fs.rmSync(file); } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
    }
  }
  throw new Error('无法取得 Prototype Talk 评审目录锁，请重试。');
}
