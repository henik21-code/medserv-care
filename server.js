// MedServ Care backend. No installs needed. Run: node server.js  (Node 18 or newer)
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,DBF=path.join(__dirname,'data','db.json'),PUB=path.join(__dirname,'public');
const FEE=+process.env.PLATFORM_FEE||0.1,CHAPA=process.env.CHAPA_SECRET_KEY,BASE=process.env.BASE_URL||`http://localhost:${PORT}`;
const CITIES={'Addis Ababa':[9.03,38.74],'Adama':[8.54,39.27],'Bahir Dar':[11.59,37.39],'Gondar':[12.6,37.47],'Hawassa':[7.06,38.48],'Mekelle':[13.5,39.47],'Dire Dawa':[9.6,41.86],'Jimma':[7.67,36.83],'Dessie':[11.13,39.63],'Jijiga':[9.35,42.8],'Arba Minch':[6.03,37.55],'Harar':[9.31,42.12],'Debre Markos':[10.33,37.73],'Nekemte':[9.09,36.55]};
const MODS=['X-ray','CT','MRI','Ultrasound','Fluoroscopy','Mammography','PET','SPECT','Dental radiography','Bone densitometry (DEXA)','C-arm or mobile X-ray','Laboratory device','Other'];
let db={users:[],jobs:[],parts:[],payments:[],sessions:{}};
fs.mkdirSync(path.dirname(DBF),{recursive:true});
if(fs.existsSync(DBF))db=JSON.parse(fs.readFileSync(DBF));
const save=()=>fs.writeFileSync(DBF,JSON.stringify(db,null,1));
const id=()=>crypto.randomBytes(6).toString('hex');
const hash=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const check=(p,h)=>{const a=Buffer.from(hash(p,h.split(':')[0])),b=Buffer.from(h);return a.length===b.length&&crypto.timingSafeEqual(a,b)};
const km=(a,b)=>{const R=6371,t=x=>x*Math.PI/180,dl=t(b[0]-a[0]),dn=t(b[1]-a[1]);const h=Math.sin(dl/2)**2+Math.cos(t(a[0]))*Math.cos(t(b[0]))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const U=i=>db.users.find(u=>u.id===i);
const pub=u=>u&&({id:u.id,role:u.role,name:u.name,email:u.email,phone:u.phone,city:u.city,specialties:u.specialties,license:u.license,verified:u.verified,senior:u.senior});
if(!db.users.some(u=>u.role==='admin')){const pw=process.env.ADMIN_PASSWORD||crypto.randomBytes(5).toString('hex');
 db.users.push({id:id(),role:'admin',name:'Admin',email:'admin@medserv.local',password:hash(pw),city:'Addis Ababa',verified:true});save();
 console.log(`\nFirst run. Admin login: admin@medserv.local  password: ${pw}\n`)}
// Demo data for a live demo (set DEMO=1). Free hosts reset files, so this recreates it on start.
if(process.env.DEMO==='1'&&!db.users.some(u=>u.role!=='admin')){
 const mk=(role,name,email,city,x={})=>{const u={id:id(),role,name,email,phone:'+251 900 000 000',password:hash('demo1234'),city,specialties:[],license:'',verified:true,senior:false,...x};db.users.push(u);return u};
 mk('hospital','Demo Hospital','hospital@demo.com','Bahir Dar');
 mk('engineer','Demo Engineer','engineer@demo.com','Gondar',{specialties:['CT','X-ray','Ultrasound'],license:'DEMO-001'});
 mk('engineer','Demo Senior Engineer','senior@demo.com','Addis Ababa',{specialties:['CT','MRI','X-ray'],license:'DEMO-002',senior:true});
 const sp=mk('supplier','Demo Parts Supplier','supplier@demo.com','Addis Ababa');
 db.parts.push({id:id(),ownerId:sp.id,name:'X-ray tube',brand:'Generic',modality:'X-ray',price:150000,stock:true,notes:'Demo listing'});
 save();console.log('Demo accounts created (password demo1234)')}
// Job matching: nearest verified engineer who covers the equipment type
function match(j){const h=U(j.hospitalId);
 const c=db.users.filter(u=>u.role==='engineer'&&u.verified&&u.specialties.includes(j.modality)&&!j.declined.includes(u.id))
  .map(u=>({u,d:km(CITIES[h.city],CITIES[u.city])})).sort((a,b)=>a.d-b.d)[0];
 if(c){j.engineerId=c.u.id;j.distanceKm=Math.round(c.d);j.status='assigned'}else{j.engineerId=null;j.distanceKm=null;j.status='open'}}
const view=j=>({...j,hospital:pub(U(j.hospitalId)),engineer:pub(U(j.engineerId)),supervisor:pub(U(j.supervisorId)),payment:db.payments.find(p=>p.jobId===j.id)||null});
const send=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const body=q=>new Promise(ok=>{let d='';q.on('data',c=>{d+=c;if(d.length>1e6)q.destroy()});q.on('end',()=>{try{ok(d?JSON.parse(d):{})}catch{ok({})}})});
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
function serve(p,r){const f=path.join(PUB,decodeURIComponent(p)==='/'?'index.html':decodeURIComponent(p));
 if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('Not found')}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)}
async function chapaVerify(P){const d=await(await fetch('https://api.chapa.co/v1/transaction/verify/'+P.txRef,{headers:{Authorization:'Bearer '+CHAPA}})).json();
 if(d.status==='success'&&d.data&&d.data.status==='success'&&+d.data.amount>=P.amount){P.status='paid';P.paidAt=Date.now();save()}}
http.createServer(async(q,r)=>{try{
 const url=new URL(q.url,'http://x'),p=url.pathname,m=q.method;
 if(!p.startsWith('/api/'))return serve(p,r);
 const b=m==='GET'?{}:await body(q),tok=(q.headers.authorization||'').slice(7),me=U(db.sessions[tok]);
 const fail=(c,t)=>send(r,c,{error:t}),ok=o=>send(r,200,o);
 const need=(...rs)=>{if(!me){fail(401,'Please sign in');return false}if(rs.length&&!rs.includes(me.role)){fail(403,'Not allowed');return false}return true};
 const session=u=>{const t=crypto.randomBytes(24).toString('hex');db.sessions[t]=u.id;save();return ok({token:t,user:pub(u)})};
 let x;
 if(p==='/api/meta')return ok({cities:Object.keys(CITIES),modalities:MODS,chapa:!!CHAPA});
 if(m==='POST'&&p==='/api/register'){
  const role=b.role,email=String(b.email||'').toLowerCase().trim();
  if(!['hospital','engineer','supplier'].includes(role))return fail(400,'Choose a role');
  if(!b.name||!/^\S+@\S+\.\S+$/.test(email)||String(b.password||'').length<8)return fail(400,'Enter a name, a valid email and a password of 8+ characters');
  if(!CITIES[b.city])return fail(400,'Choose your city');
  if(db.users.some(u=>u.email===email))return fail(400,'That email is already registered');
  const sp=(b.specialties||[]).filter(s=>MODS.includes(s));
  if(role==='engineer'&&(!b.license||!sp.length))return fail(400,'Engineers need a license or degree number and at least one specialty');
  const u={id:id(),role,name:String(b.name).slice(0,100),email,phone:String(b.phone||'').slice(0,30),password:hash(b.password),city:b.city,specialties:role==='engineer'?sp:[],license:String(b.license||'').slice(0,60),verified:role!=='engineer',senior:false};
  db.users.push(u);return session(u)}
 if(m==='POST'&&p==='/api/login'){const u=db.users.find(u=>u.email===String(b.email||'').toLowerCase().trim());
  if(!u||!check(String(b.password||''),u.password))return fail(401,'Wrong email or password');return session(u)}
 if(p==='/api/me'){if(!need())return;return ok({user:pub(me)})}
 if(m==='GET'&&p==='/api/payments/verify'){const P=db.payments.find(x=>x.txRef===url.searchParams.get('tx_ref'));if(P&&CHAPA&&P.status!=='paid')await chapaVerify(P);return ok({status:P&&P.status})}
 if(m==='POST'&&p==='/api/jobs'){if(!need('hospital'))return;
  if(!MODS.includes(b.modality)||!b.description)return fail(400,'Choose the equipment and describe the fault');
  const j={id:id(),hospitalId:me.id,modality:b.modality,description:String(b.description).slice(0,2000),urgency:b.urgency==='urgent'?'urgent':'normal',status:'open',engineerId:null,supervisorId:null,declined:[],notes:[],created:Date.now()};
  match(j);db.jobs.push(j);save();return ok({job:view(j)})}
 if(m==='GET'&&p==='/api/jobs'){if(!need())return;
  const l=db.jobs.filter(j=>me.role==='admin'||j.hospitalId===me.id||j.engineerId===me.id||j.supervisorId===me.id).sort((a,b)=>b.created-a.created);return ok({jobs:l.map(view)})}
 if(m==='POST'&&(x=p.match(/^\/api\/jobs\/(\w+)\/(\w+)$/))){if(!need())return;
  const J=db.jobs.find(j=>j.id===x[1]);if(!J)return fail(404,'Job not found');const a=x[2],mine=me.id===J.engineerId,txt=String(b.text||'').slice(0,1000);
  if(a==='note'&&(mine||me.id===J.supervisorId||me.id===J.hospitalId||me.role==='admin'))J.notes.push({by:me.name,text:txt,at:Date.now()});
  else if(a==='rematch'&&me.role==='admin')match(J);
  else if(a==='decline'&&mine&&J.status==='assigned'){J.declined.push(me.id);match(J)}
  else if(a==='start'&&mine&&J.status==='assigned')J.status='in_progress';
  else if(a==='escalate'&&mine&&['in_progress','escalated'].includes(J.status)){const s=db.users.find(u=>u.role==='engineer'&&u.verified&&u.senior&&u.id!==me.id);
   J.supervisorId=s?s.id:null;J.status='escalated';J.notes.push({by:me.name,text:'Needs help: '+txt,at:Date.now()})}
  else if(a==='complete'&&mine&&['in_progress','escalated'].includes(J.status)){const amt=Math.round(+b.amount);
   if(!(amt>0)||!b.report)return fail(400,'Add a job report and the labour charge in ETB');
   J.status='completed';J.report=String(b.report).slice(0,3000);
   db.payments.push({id:id(),jobId:J.id,hospitalId:J.hospitalId,engineerId:J.engineerId,amount:amt,fee:Math.round(amt*FEE),status:'unpaid',created:Date.now()})}
  else return fail(400,'That action is not available');
  save();return ok({job:view(J)})}
 if(m==='POST'&&(x=p.match(/^\/api\/payments\/(\w+)\/(pay|confirm)$/))){if(!need())return;
  const P=db.payments.find(y=>y.id===x[1]);if(!P)return fail(404,'Payment not found');
  if(x[2]==='confirm'){if(me.role!=='admin')return fail(403,'Not allowed');P.status='paid';P.paidAt=Date.now();save();return ok({payment:P})}
  if(me.id!==P.hospitalId||P.status==='paid')return fail(403,'Not allowed');
  if(CHAPA){P.txRef='msc-'+P.id+'-'+Date.now();const n=me.name.split(' ');
   const d=await(await fetch('https://api.chapa.co/v1/transaction/initialize',{method:'POST',headers:{Authorization:'Bearer '+CHAPA,'Content-Type':'application/json'},
    body:JSON.stringify({amount:String(P.amount),currency:'ETB',email:me.email,first_name:n[0],last_name:n.slice(1).join(' ')||'-',tx_ref:P.txRef,return_url:BASE+'/app.html?tx_ref='+P.txRef})})).json();
   if(d.status!=='success')return fail(502,'The payment provider did not accept the request');save();return ok({checkoutUrl:d.data.checkout_url})}
  P.status='awaiting_confirmation';P.ref=String(b.ref||'').slice(0,100);save();return ok({payment:P})}
 if(m==='GET'&&p==='/api/payments'){if(!need())return;return ok({payments:db.payments.filter(y=>me.role==='admin'||y.hospitalId===me.id||y.engineerId===me.id)})}
 if(m==='GET'&&p==='/api/parts'){if(!need())return;const q2=(url.searchParams.get('q')||'').toLowerCase(),md=url.searchParams.get('modality')||'';
  return ok({parts:db.parts.filter(t=>(!md||t.modality===md)&&(!q2||(t.name+' '+t.brand+' '+t.notes).toLowerCase().includes(q2))).map(t=>({...t,supplier:pub(U(t.ownerId))}))})}
 if(m==='POST'&&p==='/api/parts'){if(!need('supplier','admin','engineer'))return;if(!b.name)return fail(400,'Enter the part name');
  db.parts.push({id:id(),ownerId:me.id,name:String(b.name).slice(0,120),brand:String(b.brand||'').slice(0,60),modality:MODS.includes(b.modality)?b.modality:'Other',price:+b.price||null,stock:b.stock!=='no',notes:String(b.notes||'').slice(0,300)});save();return ok({})}
 if(m==='POST'&&(x=p.match(/^\/api\/parts\/(\w+)\/delete$/))){if(!need())return;const t=db.parts.find(y=>y.id===x[1]);
  if(!t||(t.ownerId!==me.id&&me.role!=='admin'))return fail(403,'Not allowed');db.parts=db.parts.filter(y=>y!==t);save();return ok({})}
 if(m==='GET'&&p==='/api/admin/users'){if(!need('admin'))return;return ok({users:db.users.filter(u=>u.role!=='admin').map(pub)})}
 if(m==='POST'&&(x=p.match(/^\/api\/admin\/users\/(\w+)$/))){if(!need('admin'))return;const u=U(x[1]);if(!u)return fail(404,'User not found');
  if('verified' in b)u.verified=!!b.verified;if('senior' in b)u.senior=!!b.senior;
  db.jobs.filter(j=>j.status==='open').forEach(match);save();return ok({user:pub(u)})}
 fail(404,'Not found')}catch(e){console.error(e);send(r,500,{error:'Server error'})}
}).listen(PORT,()=>console.log('MedServ Care running at http://localhost:'+PORT));
