import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupWallet} from '../public/wallet-lookup.js';
const address='0xe4c751436c25cec98bdff2c3dc253a5687e669ac';
const official={totalPoints:123,totalBasePoints:100,snapshotNumber:190,sources:[]};
test('unindexed wallet returns official points when both community endpoints fail',async()=>{
 const calls=[];
 const result=await lookupWallet(address,async path=>{calls.push(path);if(path.startsWith('/api/official-wallet'))return official;throw Error('Community unavailable')});
 assert.equal(calls[0],`/api/official-wallet?address=${address}`);
 assert.equal(result.wallet.totalPoints,123);assert.equal(result.wallet.rank,null);assert.equal(result.details.downline,null);
});
test('empty community search and missing referral details do not block new wallets',async()=>{
 const result=await lookupWallet(address,async path=>{if(path.startsWith('/api/official-wallet'))return official;if(path.startsWith('/api/leaderboard'))return {rows:[]};throw Error('404')});
 assert.equal(result.wallet.address,address);assert.equal(result.wallet.totalPoints,123);
});
test('indexed wallet keeps rank while official API supplies points',async()=>{
 const result=await lookupWallet(address,async path=>path.startsWith('/api/official-wallet')?official:path.startsWith('/api/leaderboard')?{rows:[{address,rank:12,totalPoints:1}]}:{downline:{top:[]}});
 assert.equal(result.wallet.rank,12);assert.equal(result.wallet.totalPoints,123);
});
test('never substitutes a fuzzy match or case-different Solana address',async()=>{
 const svm='HtJRbtFQPMitxmj4F7m4kSRo4nRFvb3KJZAopw7CXdzQ';
 const result=await lookupWallet(svm,async path=>path.startsWith('/api/official-wallet')?official:path.startsWith('/api/leaderboard')?{rows:[{address:svm.toLowerCase(),rank:1}]}:{downline:{top:[]}});
 assert.equal(result.wallet.address,svm);assert.equal(result.wallet.rank,null);
});
test('official failure is not replaced with stale community points',async()=>{
 await assert.rejects(lookupWallet(address,async path=>{if(path.startsWith('/api/official-wallet'))throw Error('Official unavailable');return {rows:[{address,totalPoints:1}]}}),/Official unavailable/);
});
test('indexed referral resolves, while an unindexed code asks for the address',async()=>{
 const result=await lookupWallet('MYCODE',async path=>path.startsWith('/api/leaderboard')?{rows:[{address,rank:12}]}:path.startsWith('/api/official-wallet')?official:{downline:{top:[]}});
 assert.equal(result.wallet.address,address);
 await assert.rejects(lookupWallet('NEWCODE',async()=>({rows:[]})),/Paste your full wallet address/);
});
