import React,{useEffect,useMemo,useRef,useState}from'react';
import{supabase,supabaseKey}from'./lib/supabase';
import LiveMap from'./LiveMap';
import LocationPicker from'./LocationPicker';
import{MapPin,MessageCircle,Plus,LogOut,Store,UserRound,CheckCircle2,XCircle,RefreshCw,LocateFixed,Navigation,Phone,Radio}from'lucide-react';

const TYPES={
 oven:{label:'صاحب فرن',jobs:['خباز صمون','تختجي','وكيل','داكوك','فسقجي','وزان','عجان','دلفري']},
 bakery:{label:'صاحب مخبز',jobs:['خباز','عجان','شلاع','وكيل','بادو','دلفري']},
 restaurant:{label:'صاحب مطعم',jobs:['شيف رئيسي','طباخ','مساعد طباخ','معلم مشاوي','معلم كباب','معلم شاورما','معلم برغر','معلم بيتزا','معلم فلافل','معلم سمك','معلم مقبلات','معلم سلطات','معلم معجنات','خباز','حلواني','عجان','محضر طعام','مقطع لحوم','مدير مطعم','مشرف مطعم','كابتن صالة','نادل','مقدم طعام','عامل بوفيه','عامل استقبال','كاشير','باريستا','عامل عصائر','محضر مشروبات','عامل تنظيف','غسيل صحون','عامل تجهيز طلبات','عامل تغليف','دلفري','سائق توصيل','أمين مخزن','مسؤول مشتريات','مسؤول تجهيز المواد']}
};
const money=n=>Number(n||0).toLocaleString('ar-IQ')+' د.ع';
const distance=(a,b)=>{const r=x=>x*Math.PI/180, dLat=r(b.latitude-a.latitude),dLon=r(b.longitude-a.longitude),x=Math.sin(dLat/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(dLon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
const niceError=e=>e?.message||'حدث خطأ غير متوقع';
async function invokeMihnatiAuth(body){
 const host=window.location.hostname;
 const onCloudflare=host==='mihnati.pages.dev'||host.endsWith('.mihnati.pages.dev');
 if(onCloudflare){
  const response=await fetch('/api/mihnati-auth',{method:'POST',headers:{'Content-Type':'application/json','apikey':supabaseKey,'Authorization':'Bearer '+supabaseKey},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'استجابة غير صالحة من خادم المصادقة.'}));
  if(!response.ok)throw Error(data?.error||'تعذر إكمال المصادقة.');
  return data;
 }
 const{data,error}=await supabase.functions.invoke('mihnati-auth',{body});
 if(error)throw error;
 return data;
}

export default function App(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[jobs,setJobs]=useState([]),[bookings,setBookings]=useState([]),[messages,setMessages]=useState([]),[liveLocations,setLiveLocations]=useState([]),[tab,setTab]=useState('jobs'),[chat,setChat]=useState(null),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[authMode,setAuthMode]=useState('login'),[authMethod,setAuthMethod]=useState('national'),[contact,setContact]=useState(null),[phoneEdit,setPhoneEdit]=useState(''),[trackingError,setTrackingError]=useState('');
 const[auth,setAuth]=useState({email:'',nationalId:'',password:'',name:'',type:'worker',kind:'oven',business:''});
 const[form,setForm]=useState({kind:'oven',business:'',role:'',wage:'',time:'نهاري',shift:'يوم كامل',location:'',details:''});
 const[point,setPoint]=useState(null),[draft,setDraft]=useState('');
 const lastSent=useRef(0),arrivalTriggered=useRef(false);
 const say=t=>{setNotice(t);window.setTimeout(()=>setNotice(''),5000);};
 const notifyTelegram=async bookingId=>{const{error}=await supabase.functions.invoke('mihnati-telegram',{body:{booking_id:bookingId}});if(error){say('تم تسجيل الوصول، لكن تعذر إرسال إشعار Telegram. تحقق من إعدادات البوت.');return false;}return true;};
 async function loadAll(){
  if(!supabase||!session)return;
  setBusy(true);
  try{
   const p=await supabase.from('mihnati_profiles').select('id,account_type,full_name,phone,location_text,business_type,business_name,created_at').eq('id',session.user.id).maybeSingle();
   if(p.error)throw p.error;
   if(!p.data){
    const m=session.user.user_metadata||{};
    const row={id:session.user.id,account_type:m.account_type,full_name:m.full_name,phone:m.phone,location_text:m.location_text,...(m.account_type==='business'?{business_type:m.business_type,business_name:m.business_name}:{})};
    if(!row.account_type||!row.full_name)throw Error('بيانات الحساب غير مكتملة. تواصل مع دعم المنصة.');
    const ins=await supabase.from('mihnati_profiles').insert(row).select().single();if(ins.error)throw ins.error;p.data=ins.data;
   }
   setProfile(p.data);setPhoneEdit(p.data.phone||'');
   const[j,b]=await Promise.all([
    supabase.from('mihnati_jobs').select('*').order('created_at',{ascending:false}),
    supabase.from('mihnati_bookings').select('*').or('worker_id.eq.'+session.user.id+',owner_id.eq.'+session.user.id).order('created_at',{ascending:false})
   ]);
   if(j.error)throw j.error;if(b.error)throw b.error;setJobs(j.data||[]);setBookings(b.data||[]);
  }catch(e){say(niceError(e));}finally{setBusy(false);}
 }
 useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data})=>setSession(data.session));const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>subscription.unsubscribe();},[]);
 useEffect(()=>{if(session)loadAll();else{setProfile(null);setJobs([]);setBookings([]);setChat(null);}},[session]);
 useEffect(()=>{if(!session)return;const ch=supabase.channel('mihnati-app-refresh').on('postgres_changes',{event:'*',schema:'public',table:'mihnati_jobs'},()=>loadAll()).on('postgres_changes',{event:'*',schema:'public',table:'mihnati_bookings'},()=>loadAll()).subscribe();return()=>{supabase.removeChannel(ch);};},[session]);
 const selectedBooking=chat?bookings.find(b=>b.job_id===chat.id):null;
 const myBookings=bookings.filter(b=>b.worker_id===session?.user?.id||b.owner_id===session?.user?.id);
 const filtered=useMemo(()=>jobs.filter(j=>(filter==='all'||filter===j.business_type)&&j.status!=='closed'),[jobs,filter]);
 const bothSharing=!!selectedBooking?.worker_location_sharing&&!!selectedBooking?.owner_location_sharing&&selectedBooking?.status==='agreed';
 useEffect(()=>{
  if(!chat||!selectedBooking||!supabase)return;
  let active=true;
  const load=async()=>{const r=await supabase.from('mihnati_messages').select('*').eq('booking_id',selectedBooking.id).order('created_at');if(active&&!r.error)setMessages(r.data||[]);};
  load();
  const channel=supabase.channel('mihnati-chat-'+selectedBooking.id).on('postgres_changes',{event:'*',schema:'public',table:'mihnati_messages',filter:'booking_id=eq.'+selectedBooking.id},load).subscribe();
  return()=>{active=false;supabase.removeChannel(channel);};
 },[chat?.id,selectedBooking?.id]);
 useEffect(()=>{
  if(!selectedBooking||!bothSharing)return;
  let active=true;
  const load=async()=>{const r=await supabase.from('mihnati_live_locations').select('booking_id,user_id,latitude,longitude,accuracy_m,updated_at').eq('booking_id',selectedBooking.id);if(active&&!r.error)setLiveLocations(r.data||[]);};
  load();
  const ch=supabase.channel('mihnati-location-'+selectedBooking.id).on('postgres_changes',{event:'*',schema:'public',table:'mihnati_live_locations',filter:'booking_id=eq.'+selectedBooking.id},load).subscribe();
  return()=>{active=false;supabase.removeChannel(ch);setLiveLocations([]);};
 },[selectedBooking?.id,bothSharing]);
 useEffect(()=>{
  if(!selectedBooking||!chat||!bothSharing)return;
  if(!navigator.geolocation){setTrackingError('المتصفح لا يدعم تحديد الموقع.');return;}
  setTrackingError('');
  let latestPosition=null;
  const pushLatest=async()=>{
   if(!latestPosition)return;
   const now=Date.now();if(now-lastSent.current<9000)return;lastSent.current=now;
   const{latitude,longitude,accuracy}=latestPosition.coords;
   if(accuracy>250){setTrackingError('إشارة GPS ضعيفة حالياً؛ ننتظر دقة أفضل.');return;}
   const{error}=await supabase.rpc('mihnati_update_live_location',{p_booking_id:selectedBooking.id,p_latitude:latitude,p_longitude:longitude,p_accuracy_m:accuracy});
   if(error){setTrackingError(niceError(error));return;}
   setTrackingError('');
   if(profile?.account_type==='worker'&&chat.latitude!=null&&chat.longitude!=null&&!selectedBooking.arrived_at&&!arrivalTriggered.current){
    const metres=distance({latitude,longitude},{latitude:Number(chat.latitude),longitude:Number(chat.longitude)});
    if(accuracy<=50&&metres<=100){
     arrivalTriggered.current=true;
     const result=await supabase.rpc('mihnati_mark_arrived_at_location',{p_booking_id:selectedBooking.id});
     if(!result.error){await loadAll();await notifyTelegram(selectedBooking.id);say('تم رصد وصولك إلى موقع العمل وإرسال إشعار الوصول.');}
     else{arrivalTriggered.current=false;say(niceError(result.error));}
    }
   }
  };
  const watch=navigator.geolocation.watchPosition(pos=>{latestPosition=pos;},err=>{setTrackingError(err.code===1?'لم تسمح بإذن الموقع. فعّل الموقع للمتصفح واسمح بالمشاركة.':err.code===2?'تعذر تحديد موقعك حالياً.':'انتهت مهلة تحديد الموقع.');},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
  const timer=window.setInterval(()=>{void pushLatest();},10000);
  return()=>{navigator.geolocation.clearWatch(watch);window.clearInterval(timer);};
 },[selectedBooking?.id,bothSharing,chat?.id,profile?.account_type,selectedBooking?.arrived_at]);
 async function authSubmit(e){
  e.preventDefault();if(!supabase)return say('إعدادات Supabase غير موجودة');
  if(authMode==='signup'&&auth.name.trim().split(/\s+/).length<3)return say('أدخل الاسم الثلاثي كاملاً.');
  setBusy(true);
  try{
   if(authMode==='signup'){
    const payload={action:'signup',full_name:auth.name.trim(),national_id:auth.nationalId.trim(),password:auth.password,account_type:auth.type,...(auth.type==='business'?{business_type:auth.kind,business_name:auth.business.trim()}:{})};
    const data=await invokeMihnatiAuth(payload);
    if(data?.session){const{error:setError}=await supabase.auth.setSession(data.session);if(setError)throw setError;}
    else if(data?.ok){say(data.message||'تم إنشاء الحساب. سجّل الدخول بالرقم الوطني وكلمة المرور.');setAuthMode('login');return;}
    else throw Error(data?.error||'تعذر إنشاء الحساب.');
    say(data.telegram_sent===false?'تم إنشاء الحساب، لكن تعذر إرسال إشعار تيليغرام.':'تم إنشاء الحساب وإرسال إشعار العضو الجديد.');
   }else if(authMethod==='legacy'){
    const{error}=await supabase.auth.signInWithPassword({email:auth.email.trim(),password:auth.password});if(error)throw error;
   }else{
    const data=await invokeMihnatiAuth({action:'login',national_id:auth.nationalId.trim(),password:auth.password});
    if(!data?.session)throw Error(data?.error||'الرقم الوطني أو كلمة المرور غير صحيحة.');
    const{error:setError}=await supabase.auth.setSession(data.session);if(setError)throw setError;
   }
  }catch(e){say(niceError(e));}finally{setBusy(false);}
 }
 async function publish(e){
  e.preventDefault();if(!form.role)return say('اختر التخصص بالضغط على اسمه');
  if(!form.location.trim())return say('أدخل عنوان موقع العمل');
  setBusy(true);
  const row={owner_id:session.user.id,business_type:profile.business_type,business_name:profile.business_name,job_title:form.role,details:form.details,wage:Number(form.wage),time:form.time,shift:form.shift,location_text:form.location.trim(),latitude:point?.latitude??null,longitude:point?.longitude??null};
  const r=await supabase.from('mihnati_jobs').insert(row).select().single();setBusy(false);if(r.error)return say(niceError(r.error));setJobs([r.data,...jobs]);setTab('jobs');say('تم نشر الوظيفة.');
 }
 async function reserve(job){setBusy(true);const r=await supabase.rpc('mihnati_reserve_job',{p_job_id:job.id});setBusy(false);if(r.error)return say(niceError(r.error));await loadAll();setChat(job);setTab('chat');say('تم الحجز حصرياً وفتح المحادثة.');}
 async function act(name){
  const b=selectedBooking;if(!b)return;setBusy(true);const r=await supabase.rpc(name,{p_booking_id:b.id});setBusy(false);if(r.error)return say(niceError(r.error));
  await loadAll();
  if(name==='mihnati_mark_arrived')await notifyTelegram(b.id);
  say(name==='mihnati_agree_booking'?'تم تسجيل موافقتك.':name==='mihnati_mark_arrived'?'تم تسجيل الوصول.':'تم إلغاء الحجز وإعادة الوظيفة إلى المتاح.');
 }
 async function toggleSharing(enabled){
  if(!selectedBooking)return;setBusy(true);
  const r=await supabase.rpc('mihnati_set_location_sharing',{p_booking_id:selectedBooking.id,p_enabled:enabled});setBusy(false);
  if(r.error)return say(niceError(r.error));await loadAll();
  say(enabled?'وافقت على مشاركة موقعك. يبدأ التتبع عندما يوافق الطرف الآخر أيضاً.':'أوقفت مشاركة موقعك وحُذف آخر موقع محفوظ لك.');
 }
 async function send(){if(!selectedBooking||!draft.trim())return;const r=await supabase.from('mihnati_messages').insert({booking_id:selectedBooking.id,sender_id:session.user.id,body:draft.trim()});if(r.error)return say(niceError(r.error));setDraft('');}
 async function savePhone(e){e.preventDefault();if(!phoneEdit.trim())return say('أدخل رقم هاتف صحيحاً');setBusy(true);const r=await supabase.from('mihnati_profiles').update({phone:phoneEdit.trim()}).eq('id',session.user.id);setBusy(false);if(r.error)return say(niceError(r.error));await loadAll();say('تم تحديث رقم الهاتف.');}
 function useMyLocation(){if(!navigator.geolocation)return say('المتصفح لا يدعم تحديد الموقع');setBusy(true);navigator.geolocation.getCurrentPosition(pos=>{setPoint({latitude:pos.coords.latitude,longitude:pos.coords.longitude});setBusy(false);say('تم تحديد إحداثيات موقع العمل من جهازك.');},err=>{setBusy(false);say(err.code===1?'اسمح للمتصفح بالوصول إلى الموقع.':'تعذر تحديد الموقع.');},{enableHighAccuracy:true,timeout:20000});}
 const workerLoc=liveLocations.find(x=>x.user_id===selectedBooking?.worker_id);
 const ownerLoc=liveLocations.find(x=>x.user_id===selectedBooking?.owner_id);
 const destination=chat?.latitude!=null&&chat?.longitude!=null?{latitude:chat.latitude,longitude:chat.longitude}:null;
 const mineSharing=selectedBooking&&(profile?.account_type==='worker'?selectedBooking.worker_location_sharing:selectedBooking.owner_location_sharing);
 if(!supabase)return <main className="auth"><div className="logo">م</div><h1>مِهنتي</h1><section className="panel"><h3>نعتذر، الخدمة غير متاحة مؤقتاً</h3><p>نعمل على إعادة الاتصال. يرجى المحاولة بعد قليل.</p></section></main>;
 if(!session)return <main className="auth"><div className="logo">م</div><h1>مِهنتي</h1><p>منصة فرص العمل</p><form className="panel stack" onSubmit={authSubmit}>
  <div className="switch"><button type="button" className={authMode==='login'?'on':''} onClick={()=>setAuthMode('login')}>دخول</button><button type="button" className={authMode==='signup'?'on':''} onClick={()=>{setAuthMode('signup');setAuthMethod('national');}}>حساب جديد</button></div>
  {authMode==='signup'&&<><label>نوع الحساب<select value={auth.type} onChange={e=>setAuth({...auth,type:e.target.value})}><option value="worker">عامل</option><option value="business">حساب تجاري</option></select></label>
   <label>الاسم الثلاثي<input required maxLength="120" autoComplete="name" value={auth.name} onChange={e=>setAuth({...auth,name:e.target.value})} placeholder="الاسم الثلاثي"/></label>
   <label>رقم الهوية الوطنية<input required inputMode="numeric" autoComplete="off" maxLength="24" value={auth.nationalId} onChange={e=>setAuth({...auth,nationalId:e.target.value})} placeholder="أدخل الرقم الوطني"/></label>
   {auth.type==='business'&&<><label>نوع النشاط<select value={auth.kind} onChange={e=>setAuth({...auth,kind:e.target.value})}>{Object.entries(TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label><label>اسم المنشأة<input required maxLength="160" value={auth.business} onChange={e=>setAuth({...auth,business:e.target.value})}/></label></>}
  </>}
  {authMode==='login'&&<>{authMethod==='legacy'?<label>البريد الإلكتروني<input type="email" autoComplete="username" required value={auth.email} onChange={e=>setAuth({...auth,email:e.target.value})}/></label>:<label>رقم الهوية الوطنية<input required inputMode="numeric" autoComplete="username" maxLength="24" value={auth.nationalId} onChange={e=>setAuth({...auth,nationalId:e.target.value})} placeholder="أدخل الرقم الوطني"/></label>}
   <button type="button" className="light" onClick={()=>setAuthMethod(authMethod==='legacy'?'national':'legacy')}>{authMethod==='legacy'?'الدخول بالرقم الوطني':'دخول الحسابات القديمة بالبريد الإلكتروني'}</button>
   <a className="light" href="https://wa.me/9647866360986?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D9%8B%D8%8C%20%D9%86%D8%B3%D9%8A%D8%AA%20%D9%83%D9%84%D9%85%D8%A9%20%D9%85%D8%B1%D9%88%D8%B1%D9%8A%20%D9%81%D9%8A%20%D9%85%D9%86%D8%B5%D8%A9%20%D9%85%D9%90%D9%87%D9%86%D8%AA%D9%8A" target="_blank" rel="noreferrer">نسيت كلمة المرور؟ تواصل مع صاحب المنصة 07866360986</a>
  </>}
  <label>كلمة المرور<input type="password" autoComplete={authMode==='signup'?'new-password':'current-password'} minLength="8" maxLength="72" required value={auth.password} onChange={e=>setAuth({...auth,password:e.target.value})}/></label>
  {authMode==='signup'&&<p className="muted">الرقم الوطني مشفّر على الخادم. لا نرسل كلمة المرور إلى تيليغرام.</p>}
  <button className="primary" disabled={busy}>{busy?'يرجى الانتظار':'متابعة'}</button>
 </form>{notice&&<p>{notice}</p>}</main>;
 if(!profile)return <main className="auth"><div className="panel stack"><h2>تهيئة الحساب</h2><p>تعذر تحميل ملف المستخدم. أعد المحاولة.</p><button className="primary" onClick={loadAll}>إعادة المحاولة</button><button onClick={()=>supabase.auth.signOut()}>تسجيل الخروج</button></div>{notice}</main>;
 return <main className="app">
  <header><div className="brand"><div className="logo small">م</div><b>مِهنتي</b></div><span>{profile.full_name}<button className="light" onClick={()=>supabase.auth.signOut()}><LogOut size={16}/></button></span></header>
  <section className="hero"><h1>{profile.account_type==='worker'?'اعثر على فرصة عمل':'اعثر على العامل المناسب'}</h1><p>منصة مستقلة للتوظيف والتواصل المباشر</p></section>
  <nav>{[['jobs','الوظائف'],...(profile.account_type==='business'?[['publish','نشر طلب']]:[]),['chat','الحجوزات والدردشة'],['profile','حسابي']].map(([k,v])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{v}</button>)}<button onClick={loadAll} title="تحديث"><RefreshCw size={15}/></button></nav>
  {tab==='jobs'&&<section><h2>الوظائف</h2><div className="filters"><button onClick={()=>setFilter('all')}>الكل</button>{Object.entries(TYPES).map(([k,v])=><button key={k} onClick={()=>setFilter(k)}>{v.label}</button>)}</div><div className="cards">
   {filtered.map(j=>{const b=bookings.find(x=>x.job_id===j.id&&['pending','agreed'].includes(x.status));const mine=b&&(b.worker_id===session.user.id||b.owner_id===session.user.id);return <article className="panel" key={j.id}><span className="tag">{TYPES[j.business_type]?.label}</span><h3>{j.job_title}</h3><b><Store size={15}/> {j.business_name}</b><p>{money(j.wage)} · {j.time} · {j.shift}</p><p><MapPin size={15}/> {j.location_text}</p><p><a className="light" href={j.latitude!=null&&j.longitude!=null?'https://www.google.com/maps/dir/?api=1&destination='+j.latitude+','+j.longitude:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(j.location_text)} target="_blank" rel="noreferrer">الاتجاهات إلى موقع العمل</a></p><p>{j.details}</p>{profile.account_type==='worker'&&j.status==='open'&&<button className="primary" disabled={busy} onClick={()=>reserve(j)}>حجز الوظيفة</button>}{mine&&<button className="light" onClick={()=>{setChat(j);setTab('chat');}}><MessageCircle size={16}/> فتح المحادثة</button>}{j.status==='reserved'&&!mine&&<span className="tag">محجوز حالياً</span>}{j.status==='agreed'&&<span className="tag">تم الاتفاق</span>}</article>;})}
  </div>{!filtered.length&&<p className="empty">لا توجد وظائف منشورة حالياً.</p>}</section>}
  {tab==='publish'&&profile.account_type==='business'&&<section className="narrow"><h2>نشر طلب عامل</h2><form className="panel stack" onSubmit={publish}><p>المنشأة: <b>{profile.business_name}</b> · رقم الهاتف: <b>{profile.phone}</b></p><b>اختر التخصص بالضغط على اسمه</b><div className="roles">{TYPES[profile.business_type].jobs.map(x=><button key={x} type="button" className={form.role===x?'chosen':''} onClick={()=>setForm({...form,role:x})}>{x}</button>)}</div><label>تفاصيل العمل<input maxLength="2000" value={form.details} onChange={e=>setForm({...form,details:e.target.value})}/></label><label>اليومية بالدينار<input type="number" min="0" required value={form.wage} onChange={e=>setForm({...form,wage:e.target.value})}/></label><label>الوقت<select value={form.time} onChange={e=>setForm({...form,time:e.target.value})}><option>نهاري</option><option>مسائي</option><option>ليلي</option></select></label><label>مدة الدوام<select value={form.shift} onChange={e=>setForm({...form,shift:e.target.value})}><option>يوم كامل</option><option>نصف نهار</option></select></label><label>عنوان موقع العمل<input required maxLength="250" value={form.location} onChange={e=>{setForm({...form,location:e.target.value});setPoint(null);}}/></label><button type="button" className="light" onClick={useMyLocation} disabled={busy}><LocateFixed size={16}/> تحديد إحداثيات المنشأة من موقعي</button>{point&&<p className="ok">تم حفظ نقطة الموقع: {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</p>}<p className="muted">حدد نقطة العمل على الخريطة لتفعيل تسجيل الوصول تلقائياً عند اقتراب العامل ضمن 100 متر. من دون إحداثيات، يبقى تأكيد الوصول اليدوي متاحاً.</p><LocationPicker value={point} onChange={setPoint}/><button className="primary" disabled={busy}><Plus size={16}/> نشر الوظيفة</button></form></section>}
  {tab==='chat'&&<section><h2>حجوزاتي</h2><div className="booking-list">{myBookings.map(b=>{const j=jobs.find(x=>x.id===b.job_id);return j?<button key={b.id} className={selectedBooking?.id===b.id?'active light':'light'} onClick={()=>{setChat(j);setContact(null);arrivalTriggered.current=false;}}>{j.business_name} — {j.job_title} ({b.status==='pending'?'بانتظار الموافقة':b.status==='agreed'?'تم الاتفاق':'ملغى'})</button>:null;})}</div>
   {chat&&selectedBooking&&<div className="panel stack"><h3>{chat.business_name} · {chat.job_title}</h3>
    <div className="payment">لا توجد مدفوعات داخل التطبيق حالياً. لا تحوّل أي مبلغ إلى رقم أو حساب غير موثّق من المنصة. اتفق مع الطرف الآخر مباشرةً على شروط العمل قبل تأكيد الاتفاق.</div>
    <div className="messages">{messages.map(m=><p key={m.id} className={m.sender_id===session.user.id?'mine':'bubble'}>{m.body}</p>)}</div><div className="compose"><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="اكتب رسالة" maxLength="5000"/><button className="primary" onClick={send}>إرسال</button></div>
    {selectedBooking.status==='pending'&&<><p>موافقتك: {profile.account_type==='worker'?(selectedBooking.worker_agreed?'تم':'بانتظار'):(selectedBooking.owner_agreed?'تم':'بانتظار')}</p><button className="primary" disabled={busy} onClick={()=>act('mihnati_agree_booking')}><CheckCircle2 size={16}/> تم الاتفاق</button><button className="danger" disabled={busy} onClick={()=>act('mihnati_cancel_booking')}><XCircle size={16}/> إلغاء الحجز</button></>}
    {selectedBooking.status==='agreed'&&<><p className="ok">تم الاتفاق بموافقة الطرفين.</p>
     <section className="tracking-panel"><h3><Radio size={18}/> تتبع الموقع الحي للطرفين</h3><p>يبدأ التتبع بعد موافقة الطرفين فقط. سيظهر موقعك للطرف الآخر أثناء المشاركة، ويمكنك إيقافه فوراً. نخزن آخر نقطة فقط، وإيقاف أي طرف يمسح موقعي الطرفين.</p>
      <div className="share-row"><span>مشاركة موقعي الآن</span><button className={mineSharing?'primary':'light'} disabled={busy} onClick={()=>toggleSharing(!mineSharing)}>{mineSharing?'إيقاف المشاركة':'موافقة ومشاركة الموقع'}</button></div>
      <p className="small-status">موافقة العامل: {selectedBooking.worker_location_sharing?'موافق':'لم يوافق'} · موافقة صاحب العمل: {selectedBooking.owner_location_sharing?'موافق':'لم يوافق'}</p>
      {bothSharing?<><LiveMap worker={workerLoc} owner={ownerLoc} destination={destination}/><div className="tracking-status">{workerLoc&&<p>العامل: آخر تحديث {new Date(workerLoc.updated_at).toLocaleTimeString('ar-IQ')} · دقة {Math.round(workerLoc.accuracy_m||0)}م</p>}{ownerLoc&&<p>صاحب العمل: آخر تحديث {new Date(ownerLoc.updated_at).toLocaleTimeString('ar-IQ')} · دقة {Math.round(ownerLoc.accuracy_m||0)}م</p>}{(!workerLoc||!ownerLoc)&&<p>بانتظار إرسال موقع الطرف الآخر من جهازه…</p>}</div>{trackingError&&<p className="warning">{trackingError}</p>}<p className="muted">التحديث أثناء فتح المنصة واتصال الإنترنت. قد يوقف Android التحديث عند إغلاق المتصفح أو توفير البطارية.</p></>:<p className="muted">سيظهر موقع العامل وصاحب العمل على الخريطة بعد موافقة الطرفين.</p>}
     </section>
     {profile.account_type==='worker'&&!selectedBooking.arrived_at&&<button className="primary" onClick={()=>act('mihnati_mark_arrived')} disabled={busy}><Navigation size={16}/> تأكيد الوصول يدوياً</button>}
     {selectedBooking.arrived_at&&<p className="ok">تم تسجيل وصول العامل في {new Date(selectedBooking.arrived_at).toLocaleString('ar-IQ')}.</p>}
    </>}
    {selectedBooking.status==='cancelled'&&<p>أُلغي الحجز وأصبحت الوظيفة متاحة.</p>}
   </div>}
  </section>}
  {tab==='profile'&&<section className="panel narrow stack"><UserRound/><h2>{profile.full_name}</h2><p>{profile.account_type==='worker'?'عامل':TYPES[profile.business_type]?.label}</p>{profile.business_name&&<p>{profile.business_name}</p>}<form className="stack" onSubmit={savePhone}><label><Phone size={15}/> رقم الهاتف<input type="tel" required maxLength="40" value={phoneEdit} onChange={e=>setPhoneEdit(e.target.value)}/></label><button className="primary" disabled={busy}>حفظ رقم الهاتف</button></form><p>{profile.location_text}</p></section>}
  {notice&&<div className="toast">{notice}</div>}<footer>مِهنتي © منصة توظيف مستقلة</footer>
 </main>;
}
