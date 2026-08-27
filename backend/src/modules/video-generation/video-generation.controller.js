function safeNoaDetails(error) {
  if (!String(error?.code || '').startsWith('NOA_') || !error?.details || typeof error.details !== 'object') {
    return {};
  }

  const details = {};
  for (const key of ['balanceNoa', 'requiredNoa', 'shortfallNoa']) {
    if (typeof error.details[key] === 'string') details[key] = error.details[key];
  }
  return details;
}

function createVideoGenerationController(service) {
  const owner = (req) => String(req.user?.id || '');
  const requireOwner = (req) => { const userId=owner(req); if(!userId) { const e=new Error('LOGIN_REQUIRED'); e.status=401; e.code='VIDEO_GENERATION_LOGIN_REQUIRED'; throw e; } return userId; };
  const sendError=(res,error)=>{
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error('[video-generation] request failed', { code: error?.code || 'VIDEO_GENERATION_FAILED', message: error?.message || 'Unknown error' });
    const billingDetails = safeNoaDetails(error);
    return res.status(status).json({error:error.code||'VIDEO_GENERATION_FAILED',message:status>=500?'خطای داخلی سرویس ساخت ویدیو رخ داد.':error.message,...billingDetails});
  };
  return { options: async (_req,res)=>{try{return res.json(await service.options());}catch(e){return sendError(res,e);}}, submit:async(req,res)=>{try{const job=await service.submit({userId:requireOwner(req),idempotencyKey:String(req.get('Idempotency-Key')||''),input:req.body||{}});return res.status(202).json({generationId:job.id,status:job.status,noaReservationId:job.noaReservationId||job.noa_reservation_id||null,costNoa:job.noaReservation?.amountNoa||null,unitPriceNoa:job.noaReservation?.unitPriceNoa||null,durationSeconds:String(job.duration),createdAt:job.now||job.created_at});}catch(e){return sendError(res,e);}}, list:async(req,res)=>{try{return res.json({items:await service.list(requireOwner(req))});}catch(e){return sendError(res,e);}}, get:async(req,res)=>{try{const item=await service.get(req.params.generationId,requireOwner(req));return item?res.json(item):res.status(404).json({error:'VIDEO_GENERATION_NOT_FOUND'});}catch(e){return sendError(res,e);}} };
}
module.exports = { createVideoGenerationController };
