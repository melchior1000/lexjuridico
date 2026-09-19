'use strict';

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

function toEpochMs(value) {
  if (value instanceof Date) {
    const t=value.getTime();
    return Number.isNaN(t)?null:t;
  }
  if (typeof value==='number') return Number.isFinite(value)?value:null;
  if (typeof value==='string') {
    const t=Date.parse(value);
    return Number.isNaN(t)?null:t;
  }
  return null;
}

function checkFreshness(reading,opts={}) {
  const now=Number.isFinite(opts.now)?opts.now:Date.now();
  const maxAgeMs=Number.isFinite(opts.maxAgeMs)?opts.maxAgeMs:DEFAULT_MAX_AGE_MS;
  const maxSkewMs=Number.isFinite(opts.maxClockSkewMs)?opts.maxClockSkewMs:MAX_CLOCK_SKEW_MS;
  if(!reading||typeof reading!=='object')return{fresh:false,reason:'reading_missing'};
  if(reading.ok!==true)return{fresh:false,reason:'reading_not_ok'};
  const observedMs=toEpochMs(reading.observed_at);
  if(observedMs===null)return{fresh:false,reason:reading.observed_at==null?'observed_at_missing':'observed_at_invalid'};
  if(observedMs>now+maxSkewMs)return{fresh:false,reason:'observed_at_in_future'};
  const ageMs=now-observedMs;
  if(ageMs>maxAgeMs)return{fresh:false,reason:'observed_at_expired',ageMs,maxAgeMs};
  return{fresh:true,ageMs,maxAgeMs};
}

module.exports={checkFreshness,_internal:{DEFAULT_MAX_AGE_MS,MAX_CLOCK_SKEW_MS,toEpochMs}};
