const User=require('../models/User');
async function addCardsToUser(id,cards){
 const userId=String(id),now=new Date();
 await User.updateOne({id:userId},{$setOnInsert:{id:userId}},{upsert:true}).exec();
 for(const card of cards){
 const name=String(card.name),rarity=String(card.rarity),variant=null;
 const doc=await User.findOne({id:userId},{cards:1}).lean().exec();
 const idx=doc?.cards?.findIndex(c=>c.name===name&&c.rarity===rarity&&!c.variant)??-1;
 if(idx>=0)await User.updateOne({id:userId},{$inc:{[`cards.${idx}.count`]:1},$set:{[`cards.${idx}.lastAcquiredAt`]:now}}).exec();
 else await User.updateOne({id:userId},{$push:{cards:{name,rarity,variant,count:1,firstAcquiredAt:now,lastAcquiredAt:now}}}).exec();
 }
}
module.exports={addCardsToUser};
