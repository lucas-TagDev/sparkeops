import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {test} from 'node:test';
test('Linux distribution files use LF, preventing missing interpreter and pipefail errors',()=>{for(const file of readdirSync('agent').filter(f=>/\.(py|sh)$/.test(f))){const bytes=readFileSync('agent/'+file);assert.equal(bytes.includes(13),false,file+' contains Windows line endings');assert.equal(bytes.subarray(0,3).equals(Buffer.from([239,187,191])),false,file+' contains BOM');}});
