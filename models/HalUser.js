'use strict';
const {Schema,model}=require('mongoose');
const schema=new Schema({
 userId:{type:String,required:true,unique:true,index:true},
 candies:{type:Number,default:0,min:0},
 tarotNumber:{type:Number,default:null},
 tarotDateJST:{type:String,default:null},
 tarotSource:{type:String,default:null},
 firstHolodoriBought:{type:Boolean,default:false},
 magicianUsed:{type:Boolean,default:false},
 justiceUsed:{type:Boolean,default:false},
 justiceShield:{type:Boolean,default:false},
 processedPurchaseIds:{type:[String],default:[]},
 foolExtraAwards:{type:Number,default:0}
},{timestamps:true});
module.exports=model('HalUser',schema);
