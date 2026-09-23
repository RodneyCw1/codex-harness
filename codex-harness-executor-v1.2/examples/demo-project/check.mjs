import assert from 'node:assert/strict';
import {sum} from './sum.mjs';
assert.equal(sum(2,3),5);
assert.equal(sum(-1,1),0);
console.log('两个求和场景均已通过');
