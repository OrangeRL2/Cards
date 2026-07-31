
const activities = require('../config/summer-activities.json');
const rewardTables = require('../config/summer-rewards');
const SummerUser = require('../models/SummerUser');
const User = require('../models/User');
const { findCardIsland, getIslandFolder } = require('../config/summer-cards');

const { findSunCardFile } = require('./summerCardFiles');
const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const WINDOWS = ['morning','noon','evening'];
const inFlight = new Set();

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(p => [p.type,p.value]));
}
function currentWindow(hour) { const h=Number(hour); return h < 12 ? 'morning' : h < 18 ? 'noon' : 'evening'; }
function progressKey(day, windowName) { return `day${String(day).padStart(2,'0')}_${windowName}`; }
function getDayNumber(summerUser, now = new Date()) {
  const override=Number(summerUser?.testing?.dayOverride); if (override>=1 && override<=31) return override;
  const p=jstParts(now); if (Number(p.month)!==activities.month || Number(p.year)!==activities.year) return null; return Number(p.day);
}
function getDayData(day) { return activities.days.find(d => Number(d.day)===Number(day)) || null; }
function isWindowAvailable(summerUser, windowName, now = new Date()) {
  if (summerUser?.testing?.unlockAllWindows) return true;

  const windowOrder = { morning: 0, noon: 1, evening: 2 };
  const current = currentWindow(jstParts(now).hour);
  const wantedRank = windowOrder[windowName];
  const currentRank = windowOrder[current];

  // A window cannot open before its scheduled JST start time.
  if (!Number.isInteger(wantedRank) || !Number.isInteger(currentRank)) return false;
  if (wantedRank > currentRank) return false;

  // Earlier windows remain available until midnight, but progression is linear.
  if (windowName === 'morning') return true;

  const day = getDayNumber(summerUser, now);
  if (!day) return false;

  const morningComplete = Boolean(getWindowState(summerUser, day, 'morning').completed);
  if (windowName === 'noon') return morningComplete;

  const noonComplete = Boolean(getWindowState(summerUser, day, 'noon').completed);
  if (windowName === 'evening') return morningComplete && noonComplete;

  return false;
}
function getWindowState(summerUser, day, windowName) {
  return summerUser?.activityProgress?.[progressKey(day,windowName)] || {};
}
function chooseWeighted(items) { const total=items.reduce((s,x)=>s+Number(x.weight||0),0); let roll=Math.random()*total; for (const x of items){ roll-=Number(x.weight||0); if(roll<0)return x; } return items[items.length-1]; }
function unique(values){ return [...new Set((values||[]).filter(Boolean))]; }
function cardImageUrl(name){ const card=findSunCardFile(name); return card ? `${IMAGE_BASE.replace(/\/$/,'')}/SUN/${encodeURIComponent(card.folder)}/${encodeURIComponent(card.filename)}` : null; }
async function awardCard(userId,name,storedName=name){ const now=new Date(); await User.updateOne({id:userId},{$setOnInsert:{id:userId,cards:[],points:0,pulls:0}},{upsert:true}).exec(); const hit=await User.updateOne({id:userId,cards:{$elemMatch:{name:storedName,rarity:'SUN'}}},{$inc:{'cards.$.count':1},$set:{'cards.$.lastAcquiredAt':now}}).exec(); if(!hit.matchedCount){ await User.updateOne({id:userId},{$push:{cards:{name:storedName,rarity:'SUN',count:1,firstAcquiredAt:now,lastAcquiredAt:now,locked:false}}}).exec(); } }
async function saveState(userId,key,state){ await SummerUser.updateOne({userId},{$set:{[`activityProgress.${key}`]:state}}).exec(); }
async function selectCore(userId,day,windowName,coreId){ const doc=await SummerUser.findOne({userId}).lean().exec(); const win=getDayData(day)?.windows?.[windowName]; const core=win?.coreActivities?.find(x=>x.id===coreId); if(!core)return {success:false,reason:'INVALID'}; const key=progressKey(day,windowName), old=getWindowState(doc,day,windowName); if(old.completed)return {success:false,reason:'COMPLETED'}; if(old.coreId && old.coreId!==coreId)return {success:false,reason:'LOCKED'}; const state={...old,coreId,stepId:core.steps[0]?.id||'',eligibleSunMembers:old.eligibleSunMembers||[],choices:old.choices||[],flags:old.flags||[],startedAt:old.startedAt||new Date()}; await saveState(userId,key,state); return {success:true,core,state}; }
async function chooseOption(userId,day,windowName,coreId,stepId,optionId){ const key=String(userId); if(inFlight.has(key))return {success:false,reason:'BUSY'}; inFlight.add(key); try { const doc=await SummerUser.findOne({userId:key}).lean().exec(); const win=getDayData(day)?.windows?.[windowName], core=win?.coreActivities?.find(x=>x.id===coreId), step=core?.steps?.find(x=>x.id===stepId), option=step?.options?.find(x=>x.id===optionId); if(!core||!step||!option)return {success:false,reason:'INVALID'}; const pkey=progressKey(day,windowName), old=getWindowState(doc,day,windowName); if(old.completed)return {success:false,reason:'COMPLETED'}; if(old.coreId!==coreId || old.stepId!==stepId)return {success:false,reason:'STALE'}; const eligible=unique([...(old.eligibleSunMembers||[]),...(option.eligibleSunMembers||[])]).filter(name=>Boolean(findSunCardFile(name))); const choices=[...(old.choices||[]),{stepId,optionId}]; const flags=unique([...(old.flags||[]),option.setFlag]); if(option.nextStepId){ const state={...old,stepId:option.nextStepId,eligibleSunMembers:eligible,choices,flags,lastResultDialogue:option.resultDialogue}; await saveState(key,pkey,state); return {success:true,completed:false,core,option,state}; }
    const table=rewardTables[core.rewardTableId]||rewardTables.summer_activity_default; let reward=chooseWeighted(table); if(reward.type==='sunCard' && eligible.length===0) reward={type:'shells',amount:20};
    const state={...old,stepId:'',eligibleSunMembers:eligible,choices,flags,lastResultDialogue:option.resultDialogue,completed:true,completedAt:new Date(),reward};
    const guard=await SummerUser.updateOne({userId:key,[`activityProgress.${pkey}.completed`]:{$ne:true}},{$set:{[`activityProgress.${pkey}`]:state,'stats.lastActivityAt':new Date()},$inc:{'stats.activitiesCompleted':1}}).exec(); if(!guard.modifiedCount)return {success:false,reason:'COMPLETED'};
    if(reward.type==='shells') await SummerUser.updateOne({userId:key},{$inc:{summerShells:reward.amount}}).exec();
    if(reward.type==='sunPulls') await SummerUser.updateOne({userId:key},{$inc:{sunPulls:reward.amount}}).exec();
    if(reward.type==='sunCard'){ const name=eligible[Math.floor(Math.random()*eligible.length)]; reward={...reward,name,imageUrl:cardImageUrl(name)}; await awardCard(key,name); await SummerUser.updateOne({userId:key},{$inc:{'stats.sunCardsEarned':1}}).exec(); await SummerUser.updateOne({userId:key},{$set:{[`activityProgress.${pkey}.reward`]:reward}}).exec(); }
    return {success:true,completed:true,core,option,state:{...state,reward},reward};
  } catch(error){ console.error('[summerActivity]',error); return {success:false,reason:'ERROR',error}; } finally { inFlight.delete(key); }
}
module.exports={ WINDOWS,jstParts,currentWindow,progressKey,getDayNumber,getDayData,isWindowAvailable,getWindowState,selectCore,chooseOption };


