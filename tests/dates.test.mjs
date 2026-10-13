import test from 'node:test';
import assert from 'node:assert/strict';
import {wareki,localDate,localMonth} from '../src/utils.ts';

test('Japanese date labels respect era boundaries and Tokyo calendar dates',()=>{
  assert.equal(wareki('2019-04'),'平成31年4月');
  assert.equal(wareki('2019-05'),'令和元年5月');
  assert.equal(wareki('1989-01-07'),'昭和64年1月7日');
  assert.equal(wareki('1989-01-08'),'平成元年1月8日');
  assert.equal(wareki('2026-10'),'令和8年10月');
  assert.equal(wareki('2026-10-13'),'令和8年10月13日');
  assert.equal(localDate(new Date('2026-10-13T15:05:00Z')),'2026-10-14');
  assert.equal(localMonth(new Date('2026-10-31T16:00:00Z')),'2026-11');
});
