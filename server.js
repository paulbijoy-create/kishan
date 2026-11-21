// Kishan backend. Node 20+, no dependencies. Run: ANTHROPIC_API_KEY=... DATA_GOV_KEY=... node server.js
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const PORT=process.env.PORT||3000,AK=process.env.ANTHROPIC_API_KEY,DK=process.env.DATA_GOV_KEY,MODEL=process.env.MODEL||'claude-sonnet-5-5';
const root=import.meta.dirname,OK=new Set(['index.html','app.html','manifest.json','sw.js','icon-192.png','icon-512.png']),cd=path.join(import.meta.dirname,'cache');fs.mkdirSync(cd,{recursive:true});
const LN={en:'English',hi:'Hindi',bn:'Bengali',ta:'Tamil',te:'Telugu',mr:'Marathi',gu:'Gujarati',kn:'Kannada',ml:'Malayalam',pa:'Punjabi',or:'Odia'};
const COMM={Rice:'Paddy(Dhan)(Common)',Wheat:'Wheat',Maize:'Maize',Cotton:'Cotton',Soybean:'Soyabean',Groundnut:'Groundnut',Potato:'Potato',Tomato:'Tomato',Onion:'Onion',Mustard:'Mustard',Chickpea:'Bengal Gram(Gram)(Whole)',Jute:'Jute'};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const send=(r,c,o)=>{r.writeHead(c,{'content-type':'application/json; charset=utf-8'});r.end(JSON.stringify(o))};
const body=q=>new Promise((ok,no)=>{let b='';q.on('data',c=>{b+=c;if(b.length>9e6){q.destroy();no(new Error('too large'))}});q.on('end',()=>{try{ok(b?JSON.parse(b):{})}catch(e){no(e)}})});
const hits=new Map();const limited=ip=>{const h=Date.now()-36e5,a=(hits.get(ip)||[]).filter(t=>t>h);a.push(Date.now());hits.set(ip,a);return a.length>60};

const GK=process.env.GEMINI_API_KEY,GM=process.env.GEMINI_MODEL||'gemini-flash-latest';
async function claude(content,system,max=1500){
  if(GK){
    const parts=(Array.isArray(content)?content:[{type:'text',text:content}]).map(b=>b.type==='image'?{inline_data:{mime_type:b.source.media_type,data:b.source.data}}:{text:b.text});
    const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GM}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':GK},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts}],generationConfig:{maxOutputTokens:Math.max(max,2000)*2}})});
    const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'AI error');
    return(j.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('')||(()=>{throw new Error('Empty AI reply')})();
  }
  if(!AK)throw new Error('Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY on the server');
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':AK,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:max,system,messages:[{role:'user',content}]})});
  const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'AI error');return j.content.map(x=>x.text||'').join('');
}
// Forecast: Open-Meteo (free, no key). To use IMD/INSAT-3D products later, replace this one function.
async function weather(q){
  let{lat,lon,place}=q;
  if(!(lat&&lon)){
    if(!place)throw new Error('lat/lon or place required');
    const g=await(await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place.split(',')[0].trim())}&count=1&country_code=IN`)).json();
    const x=g.results?.[0];if(!x)throw new Error('Place not found');lat=x.latitude;lon=x.longitude;
  }
  const u=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration&timezone=Asia%2FKolkata&forecast_days=10`;
  const j=await(await fetch(u)).json();if(j.error)throw new Error(j.reason||'weather error');return{lat,lon,...j};
}
// Mandi prices: Agmarknet daily prices via data.gov.in open API (needs free DATA_GOV_KEY).
async function prices(q){
  if(!DK)throw new Error('DATA_GOV_KEY is not set on the server');
  const c=COMM[q.crop];if(!c)return[];
  const u=new URL('https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070');
  u.search=new URLSearchParams({'api-key':DK,format:'json',limit:'200','filters[commodity]':c,...(q.state?{'filters[state]':q.state}:{})});
  const j=await(await fetch(u)).json();
  const g=(r,k)=>r[k]??r[k[0].toUpperCase()+k.slice(1)];
  return(j.records||[]).map(r=>({market:g(r,'market'),district:g(r,'district'),state:g(r,'state'),date:g(r,'arrival_date'),min:+g(r,'min_price'),max:+g(r,'max_price'),modal:+g(r,'modal_price')})).filter(r=>r.modal>0);
}
const sysFor=(lang,place)=>`You are Kishan, a practical farming advisor for Indian farmers. Reply ONLY in ${LN[lang]||'English'} using simple short sentences a farmer can follow. Use "-" for lists and no other markdown symbols. Farm location: ${place||'India'}. Today is ${new Date().toDateString()}. Use the data given to you; never invent live numbers. Name pesticides by active ingredient, only ones legal in India. Always add one line: read the label, wear protection, and confirm with the local Krishi Vigyan Kendra or agriculture officer before spraying.`;

http.createServer(async(q,r)=>{
  try{
    const u=new URL(q.url,'http://x'),p=u.pathname,ip=q.headers['x-forwarded-for']||q.socket.remoteAddress;
    if(p==='/api/weather')return send(r,200,await weather(Object.fromEntries(u.searchParams)));
    if(p==='/api/prices')return send(r,200,{records:await prices(Object.fromEntries(u.searchParams))});
    if(p==='/api/advise'&&q.method==='POST'){
      if(limited(ip))return send(r,429,{error:'Too many requests'});
      const{prompt,lang,place,image}=await body(q);
      const content=[...(image?[{type:'image',source:{type:'base64',media_type:image.type,data:image.data}}]:[]),{type:'text',text:String(prompt).slice(0,6000)}];
      return send(r,200,{text:await claude(content,sysFor(lang,place))});
    }
    if(p==='/api/i18n'&&q.method==='POST'){
      const{lang,dict}=await body(q);if(!LN[lang])return send(r,400,{error:'language'});
      const f=path.join(cd,lang+'-'+crypto.createHash('md5').update(JSON.stringify(dict)).digest('hex').slice(0,10)+'.json');
      if(fs.existsSync(f))return send(r,200,JSON.parse(fs.readFileSync(f,'utf8')));
      if(limited(ip))return send(r,429,{error:'Too many requests'});
      const out=await claude(JSON.stringify(dict),`Translate the JSON values from English to ${LN[lang]} for farmers, in simple everyday words. Keep keys unchanged. Keep placeholders like {n}, numbers, the ₹ sign and the word Kishan exactly. Return only valid JSON.`,8000);
      const j=JSON.parse(out.replace(/```json|```/g,'').trim());fs.writeFileSync(f,JSON.stringify(j));return send(r,200,j);
    }
    const n=p==='/'?'index.html':p.slice(1);let f=path.join(root,n);
    if(!OK.has(n)||!fs.existsSync(f)){r.writeHead(404);return r.end('Not found')}
    r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);
  }catch(e){send(r,500,{error:e.message})}
}).listen(PORT,()=>console.log('Kishan running on :'+PORT));
