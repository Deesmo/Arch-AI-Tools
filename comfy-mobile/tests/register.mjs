// Entry for `node --import ./tests/register.mjs --test tests/*.test.mjs`.
import { register } from 'node:module';

register('./ts-loader.mjs', import.meta.url);
