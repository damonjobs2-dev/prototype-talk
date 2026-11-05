import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireServerLock } from './server-lock.mjs';

test('one review directory cannot be written by two servers at once', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-lock-test-'));
  const outputRoot = path.join(baseDir, 'review');
  try {
    const release = acquireServerLock(outputRoot, 4203, { baseDir });
    assert.throws(() => acquireServerLock(outputRoot, 4204, { baseDir }), /4203/);
    release();
    const releaseAgain = acquireServerLock(outputRoot, 4204, { baseDir });
    releaseAgain();
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('a dead server lock is replaced without blocking the next preview', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-lock-test-'));
  const outputRoot = path.join(baseDir, 'review');
  try {
    const release = acquireServerLock(outputRoot, 4203, { baseDir, pid: 99999999, pidAlive: () => false });
    const releaseAgain = acquireServerLock(outputRoot, 4204, { baseDir, pidAlive: () => false });
    release();
    assert.throws(() => acquireServerLock(outputRoot, 4205, { baseDir }), /4204/);
    releaseAgain();
  } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});
