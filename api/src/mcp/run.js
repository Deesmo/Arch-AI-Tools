#!/usr/bin/env node
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsx = join(__dirname, 'node_modules', '.bin', 'tsx');
const server = join(__dirname, 'server.ts');

const child = spawn(tsx, [server], { stdio: 'inherit', env: process.env });
child.on('exit', code => process.exit(code ?? 0));
