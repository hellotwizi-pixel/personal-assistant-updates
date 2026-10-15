/* Personal Assistant. Pure, deterministic domain engine. No network or model access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AssistantCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '0.4.0';
  const PROJECTS = ['개인일정', '취미', 'DMmate', '하하팩토리', '캐나다 골프사업', '디토크', '바베큐국립공원', 'AI Office'];
  // Owner-editable folders (2026-10-14). Until the first edit the eight defaults apply unchanged.
  const PROJECT_ICONS = ['calendar','book','spark','folder','report','home','archive','bell','image','clock'];
  const DEFAULT_PROJECT_ICONS = ['calendar','book','spark','folder','folder','report','folder','spark'];
  // A fresh install that never joined the owner's Mac starts with plain folders; the owner's eight
  // arrive with pairing (owner 2026-10-15: other people install this app for their own records).
  const STARTER_PROJECTS = ['개인일정', '업무', '취미'];
  const STARTER_ICONS = ['calendar','folder','book'];
  const DAY = 86400000, MINUTE = 60000;
  const TYPES = ['task', 'event', 'reference', 'note'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const same = (a,b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const uuid = () => globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
  const pad = n => String(n).padStart(2,'0');
  function zoneParts(ms, zone) {
    const p = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
    const a={}; p.forEach(x=>a[x.type]=x.value);
    return {date:`${a.year}-${a.month}-${a.day}`,hour:+a.hour,minute:+a.minute,second:+a.second};
  }
  function validDate(s) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    const d=new Date(s+'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0,10)===s;
  }
  function addDays(s,n) { if(!validDate(s)) throw new Error('올바른 날짜가 아닙니다.'); return new Date(Date.parse(s+'T00:00:00Z')+n*DAY).toISOString().slice(0,10); }
  function weekday(s) {return new Date(s+'T00:00:00Z').getUTCDay();}
  function monthDays(year,month) {return new Date(Date.UTC(year,month,0)).getUTCDate();}
  function localEpoch(date,hour,minute,zone) {
    if(!validDate(date)||hour<0||hour>23||minute<0||minute>59) return null;
    const target=Date.parse(`${date}T${pad(hour)}:${pad(minute)}:00Z`);
    let guess=target;
    for(let i=0;i<5;i++) {const p=zoneParts(guess,zone), actual=Date.parse(`${p.date}T${pad(p.hour)}:${pad(p.minute)}:00Z`); const delta=target-actual; if(delta===0) return guess; guess+=delta;}
    return null; // A nonexistent local time (DST jump) is not silently shifted.
  }
  function finalAlarm(start, evaluatedAt) {
    const r=start-evaluatedAt;
    if(!Number.isFinite(start)||r<=0) return null;
    const lead=r>=60*MINUTE?60:r>=30*MINUTE?30:r>=10*MINUTE?10:0;
    return {at:lead?start-lead*MINUTE:evaluatedAt,leadMinutes:lead,evaluatedAt};
  }
  function dateParse(text, ms, zone) {
    const today=zoneParts(ms,zone).date, result={date:null,endDate:null,time:null,unresolved:[]};
    let m;
    if((m=text.match(/(20\d{2})[년.\-/ ]+(\d{1,2})[월.\-/ ]+(\d{1,2})(?:일)?/))) result.date=`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    else if((m=text.match(/(\d{1,2})월\s*(\d{1,2})일/))) {
      let year=+today.slice(0,4); result.date=`${year}-${pad(+m[1])}-${pad(+m[2])}`;
      if(result.date<today) result.date=`${year+1}-${pad(+m[1])}-${pad(+m[2])}`;
    } else if((m=text.match(/(이번\s*달|이달|다음\s*달|다다음\s*달)\s*(?:(\d{1,2})\s*일|(말일|말))/))) {
      const offset=/다다음/.test(m[1])?2:/다음/.test(m[1])?1:0;
      const first=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-1+offset,1));
      const y=first.getUTCFullYear(),mo=first.getUTCMonth()+1,last=new Date(Date.UTC(y,mo,0)).getUTCDate();
      result.date=m[3]?`${y}-${pad(mo)}-${pad(last)}`:`${y}-${pad(mo)}-${pad(+m[2])}`;
    } else if(/(?:이번\s*달|이달|다음\s*달|다다음\s*달)/.test(text)) result.unresolved.push('date');
    else if((m=text.match(/(?:^|[^\d월.\-/])(\d{1,2})\s*일(?:까지|에|날|\s|$)(?!\s*(?:동안|간))/))) {
      // A bare day of month means its next occurrence (this month, or next month once it has passed).
      const y=+today.slice(0,4),mo=+today.slice(5,7);let date=`${y}-${pad(mo)}-${pad(+m[1])}`;
      if(date<today){const next=new Date(Date.UTC(y,mo,1));date=`${next.getUTCFullYear()}-${pad(next.getUTCMonth()+1)}-${pad(+m[1])}`;}
      result.date=date;
    } else if(/글피/.test(text)) result.date=addDays(today,3);
    else if(/모레|내일모레/.test(text)) result.date=addDays(today,2);
    else if(/내일/.test(text)) result.date=addDays(today,1);
    else if(/오늘/.test(text)) result.date=today;
    const daychars='일월화수목금토';
    const multi=text.match(/(?:다음\s*주|이번\s*주)\s*([월화수목금토일]{2,7})(?:요일)?/);
    if(multi) {
      const monday=addDays(today,-((weekday(today)+6)%7)+(/다음\s*주/.test(multi[0])?7:0));
      const ds=[...multi[1]].map(c=>addDays(monday,(daychars.indexOf(c)+6)%7)).sort();
      result.date=ds[0]; result.endDate=ds[ds.length-1]; result.dates=ds;
    } else if((m=text.match(/(?:(다음\s*주|이번\s*주|다다음\s*주)\s*)?([월화수목금토일])요일/))) {
      const w=daychars.indexOf(m[2]);
      if(m[1]) {const offset=/다다음/.test(m[1])?14:/다음/.test(m[1])?7:0; const monday=addDays(today,-((weekday(today)+6)%7)+offset); result.date=addDays(monday,(w+6)%7);}
      else result.date=addDays(today,(w-weekday(today)+7)%7);
    } else if(/다음\s*주/.test(text) && !result.date) result.unresolved.push('date');
    const koNums={'한':1,'두':2,'세':3,'네':4,'다섯':5,'여섯':6,'일곱':7,'여덟':8,'아홉':9,'열':10,'열한':11,'열두':12};
    let clockText=text.replace(/(열두|열한|여덟|여섯|일곱|아홉|다섯|한|두|세|네|열)\s*시/g,(_,x)=>koNums[x]+'시');
    m=clockText.match(/(?:(오전|오후|저녁|밤|새벽|아침)\s*)?(\d{1,2})\s*(?:시|:)\s*(?:(\d{1,2})\s*분?|반)?/);
    if(m) {
      let hour=+m[2], minute=+m[3]||(/반/.test(m[0])?30:0);
      if(/오후|저녁|밤/.test(m[1]||'') && hour<12) hour+=12;
      if(/오전|새벽|아침/.test(m[1]||'') && hour===12) hour=0;
      if(!m[1] && hour>=1 && hour<=12 && !m[0].includes(':')) result.unresolved.push('meridiem');
      if(hour<=23 && minute<=59) result.time={hour,minute}; else result.unresolved.push('time');
    } else if(/정오|점심\s*12시/.test(text)) result.time={hour:12,minute:0};
    if(result.date&&!validDate(result.date)){result.date=null;result.unresolved.push('date');}
    return result;
  }
  function recurrenceParse(text) {
    const r={freq:null,interval:1,weekdays:[],day:null,lastDay:false,invalidDay:'ask',unresolved:[]};
    if(/매일|날마다/.test(text)) r.freq='daily';
    else if(/매주|매\s*주|매\s*[월화수목금토일]요일/.test(text)) {
      r.freq='weekly'; const days=text.match(/[월화수목금토일](?=요일)/g)||[];
      r.weekdays=[...new Set(days.map(c=>'일월화수목금토'.indexOf(c)))];
      if(!r.weekdays.length) r.unresolved.push('repeatWeekday');
    } else if(/매월|매달/.test(text)) {
      r.freq='monthly'; r.lastDay=/말일|마지막\s*날/.test(text);
      const m=text.match(/(?:매월|매달)\s*(\d{1,2})일/); r.day=m?+m[1]:null;
      if(!r.day&&!r.lastDay) r.unresolved.push('repeatDay');
      if(r.day>28) r.unresolved.push('monthlyPolicy');
      if(r.day>31||r.day===0) r.unresolved.push('repeatDay');
    }
    return r.freq?r:null;
  }
  const aliases = {
    '개인일정':['개인일정','개인 일정','가족','예비군'], '취미':['취미','발레','영화','음악','책','독서','공연'],
    'DMmate':['dmmate','dm mate','디엠메이트','디엠 메이트'], '하하팩토리':['하하팩토리','하하 팩토리'],
    '캐나다 골프사업':['캐나다 골프','에이스골프','에이스 골프','올댓골프','올댓 골프','펨브룩','ace golf'],
    '디토크':['디토크','d.talk','d talk'], '바베큐국립공원':['바베큐국립공원','바베큐 국립공원'],
    'AI Office':['ai office','ai오피스','ai 오피스','에이아이 오피스']
  };
  function classify(text,names=PROJECTS) {
    const low=text.toLowerCase(), explicit=names.filter(p=>low.includes(p.toLowerCase()));
    if(explicit.length===1)return explicit[0];
    if(explicit.length>1)return null;
    const hits=names.filter(p=>(aliases[p]||[]).some(a=>low.includes(a.toLowerCase())));
    return hits.length===1?hits[0]:null;
  }
  function titleOf(text,names=PROJECTS) {
    let s=text.split(/하위\s*(?:항목|체크(?:리스트)?)\s*(?:은|는|:)/)[0].replace(/[,，\s]+$/,'');
    names.forEach(p=>{s=s.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:에|에서)?\\s*'),'');});
    s=s.replace(/(?:다다음\s*주|다음\s*주|이번\s*주)?\s*[월화수목금토일]요일(?:에|까지|로)?/g,'')
      .replace(/(?:다음\s*주|이번\s*주)\s*[월화수목금토일]{2,7}/g,'')
      .replace(/20\d{2}[년.\-/ ]+\d{1,2}[월.\-/ ]+\d{1,2}(?:일)?(?:까지|에)?/g,'')
      .replace(/\d{1,2}월\s*\d{1,2}일(?:까지|에)?/g,'')
      .replace(/(?:내일모레|모레|글피|내일|오늘)(?:까지|에)?/g,'')
      .replace(/(?:오전|오후|저녁|밤|새벽|아침)?\s*(?:\d{1,2}|열두|열한|여덟|여섯|일곱|아홉|다섯|한|두|세|네|열)\s*(?:시|:)\s*(?:(?:\d{1,2})\s*분?|반)?(?:에)?/g,'')
      .replace(/매일|날마다|매주|매\s*주|매월\s*(?:\d{1,2}일|말일)?|매달\s*(?:\d{1,2}일|말일)?/g,'')
      .replace(/(?:등록하고|등록해(?:줘)?|등록|추가해(?:줘)?|기록해(?:줘)?|저장해(?:줘)?|알려줘|있음|잡힘)[.!。]?\s*$/,'')
      .replace(/[,.。]+\s*$/,'').replace(/\s+/g,' ').trim();
    return s||text.trim().slice(0,160);
  }
  function hobbyType(t){return /책|독서/.test(t)?'책':/영화/.test(t)?'영화':/음악|노래|앨범/.test(t)?'음악':'기타';}
  function parseCreate(text, ms, zone, id, names=PROJECTS) {
    const dt=dateParse(text,ms,zone), recurrence=recurrenceParse(text), project=classify(text,names);
    const reference=/예비군|휴가|출장|부재/.test(text) && /(?:[가-힣]{2,5}(?:이|씨|님|의)|직원|정민)/.test(text) && !/내\s*(?:휴가|출장|예비군)/.test(text);
    let type=reference?'reference':dt.time?'event':/(?:책|영화|음악|노래|앨범|링크|https?:\/\/)/.test(text)&&!dt.date&&!recurrence?'note':'task';
    if(/메모|기록만|추천받|추천함/.test(text)&&!dt.time&&!recurrence) type='note';
    const unresolved=[...dt.unresolved]; if(!project)unresolved.push('project');
    if(type==='event'&&!dt.date&&!recurrence)unresolved.push('date');
    if(recurrence)unresolved.push(...recurrence.unresolved);
    const start=type==='event'&&dt.date&&dt.time&&!unresolved.includes('meridiem')?localEpoch(dt.date,dt.time.hour,dt.time.minute,zone):null;
    if(type==='event'&&dt.date&&dt.time&&start===null&&!unresolved.includes('meridiem'))unresolved.push('time');
    let children=[]; const sub=text.split(/하위\s*(?:항목|체크(?:리스트)?)\s*(?:은|는|:)/)[1];
    if(sub) children=sub.split(/[,，\n]|그리고|\s+\/\s+/).map(s=>s.replace(/[.。]$/,'').trim()).filter(Boolean).map((title,i)=>({id:`${id}:c${i}`,title,done:false,completedAt:null}));
    const item={id,type,title:titleOf(text,names),body:text,project,createdAt:ms,updatedAt:ms,timezone:zone,
      dueDate:type==='task'?dt.date:null,originalDueDate:type==='task'?dt.date:null,plannedDate:null,
      date:(type==='event'||type==='reference')?dt.date:null,endDate:dt.endDate||dt.date,dates:dt.dates||null,
      startAt:start,endAt:null,time:dt.time,startVersion:1,final: start?finalAlarm(start,ms):null,
      done:false,completedAt:null,children,attachments:[],links:(text.match(/https?:\/\/[^\s]+/g)||[]),
      hobby:type==='note'&&project==='취미'?hobbyType(text):null,recurrence,seriesId:null,
      needsReview:[...new Set(unresolved)],captureId:id,deleted:false};
    return item;
  }
  function emptyState(deviceId=uuid()) {
    return {schema:1,version:VERSION,deviceId,items:{},series:{},captures:{},reports:{},receipts:{},projects:{},notices:{},ops:[],conflicts:[],history:[],cursor:0,
      settings:{projectSet:'starter',timezone:'Asia/Seoul',timezoneMode:'phone',role:'primary',morning:10,noon:12,evening:20,summaryLines:0,autoParent:true,recurrenceHorizon:90},lastSync:null};
  }
  function containerFor(state,type){const map={item:'items',series:'series',capture:'captures',report:'reports',receipt:'receipts',project:'projects'}; if(!map[type])throw new Error('알 수 없는 데이터 종류');if(!state[map[type]])state[map[type]]={};return state[map[type]];}
  function projectList(state){
    const saved=Object.values(state.projects||{});
    if(!saved.length){const d=defaultProjects(state);return d.names.map((name,i)=>({id:d.prefix+i,name,icon:d.icons[i]||'folder',order:i,builtin:true}));}
    return saved.filter(p=>!p.deleted).sort((a,b)=>(a.order??0)-(b.order??0));
  }
  function projectNames(state){return projectList(state).map(p=>p.name);}
  // The first edit turns the defaults into synced records so every device sees the same folders.
  function defaultProjects(state){const s=state.settings||{};
    if(Array.isArray(s.defaultProjects)&&s.defaultProjects.length)return {names:s.defaultProjects,prefix:'project:default-',icons:s.defaultProjects.map((_,i)=>DEFAULT_PROJECT_ICONS[i]||'folder')};
    // Saved states from before this setting existed are the owner's own devices.
    if(s.projectSet==='starter')return {names:STARTER_PROJECTS,prefix:'project:starter-',icons:STARTER_ICONS};
    return {names:PROJECTS,prefix:'project:default-',icons:DEFAULT_PROJECT_ICONS};}
  function ensureProjects(state,ms=Date.now()){if(Object.keys(state.projects||{}).length)return;const d=defaultProjects(state);d.names.forEach((name,i)=>write(state,'project',d.prefix+i,{name,icon:d.icons[i]||'folder',order:i,deleted:false,createdAt:ms},ms));}
  /** Pairing with a Mac hands over that owner's folder names; only a device whose folders were never edited takes them. */
  function adoptOwnerProjects(state,names){if(!Array.isArray(names)||!names.length||Object.keys(state.projects||{}).length)return false;
    const clean=names.map(n=>String(n||'').replace(/\s+/g,' ').trim()).filter(n=>n&&n.length<=30).slice(0,30);if(!clean.length)return false;
    state.settings=state.settings||{};state.settings.defaultProjects=clean;return true;}
  function cleanProjectName(name,state,exceptId){const n=String(name||'').replace(/\s+/g,' ').trim();if(!n)throw new Error('폴더 이름을 입력해주세요.');if(n.length>30)throw new Error('폴더 이름은 30자까지 쓸 수 있어요.');if(projectList(state).some(p=>p.name===n&&p.id!==exceptId))throw new Error('같은 이름의 폴더가 이미 있어요.');return n;}
  function addProject(state,name,icon='folder',ms=Date.now()){ensureProjects(state,ms);const n=cleanProjectName(name,state);const order=Math.max(-1,...projectList(state).map(p=>p.order??0))+1;const id='project:'+uuid();write(state,'project',id,{name:n,icon:PROJECT_ICONS.includes(icon)?icon:'folder',order,deleted:false,createdAt:ms},ms);return id;}
  function renameProject(state,id,name,ms=Date.now()){ensureProjects(state,ms);const p=state.projects[id];if(!p||p.deleted)throw new Error('폴더를 찾지 못했어요.');const n=cleanProjectName(name,state,id),old=p.name;if(n===old)return;write(state,'project',id,{name:n,updatedAt:ms},ms);
    // Records keep pointing at their folder by name, so they move with the rename.
    Object.values(state.items).filter(x=>!x.deleted&&x.project===old).forEach(x=>write(state,'item',x.id,{project:n,updatedAt:ms},ms));}
  function setProjectIcon(state,id,icon,ms=Date.now()){ensureProjects(state,ms);if(!state.projects[id])throw new Error('폴더를 찾지 못했어요.');if(!PROJECT_ICONS.includes(icon))throw new Error('아이콘을 확인해주세요.');write(state,'project',id,{icon,updatedAt:ms},ms);}
  function deleteProject(state,id,ms=Date.now()){ensureProjects(state,ms);const p=state.projects[id];if(!p||p.deleted)throw new Error('폴더를 찾지 못했어요.');write(state,'project',id,{deleted:true,updatedAt:ms},ms);
    // Records are never deleted with a folder; they go back to 확인함 to be filed again.
    Object.values(state.items).filter(x=>!x.deleted&&x.project===p.name).forEach(x=>write(state,'item',x.id,{project:null,needsReview:[...new Set([...(x.needsReview||[]),'project'])],updatedAt:ms},ms));}
  function write(state,type,id,patch,ms=Date.now()) {
    if(typeof id!=='string'||!/^[A-Za-z0-9_.:@+\-]{1,240}$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw new Error('기록 식별자가 올바르지 않습니다.');
    if(Object.keys(patch).some(k=>['__proto__','constructor','prototype'].includes(k)))throw new Error('허용되지 않은 필드입니다.');
    const target=containerFor(state,type), old=target[id]||null;
    const base={};Object.keys(patch).forEach(k=>base[k]=old&&old[k]!==undefined?clone(old[k]):null);
    const op={opId:uuid(),entity:type,id,create:old===null,base:old===null?null:base,patch:clone(patch),at:ms,device:state.deviceId};
    target[id]=Object.assign({},old||{},clone(patch),{id});
    state.ops.push(op);state.history.unshift({id:op.opId,entity:type,itemId:id,at:ms,before:old?clone(old):null,after:clone(target[id])});
    state.history=state.history.slice(0,400);return target[id];
  }
  function ensureRecurrences(state,ms=Date.now()) {
    const today=zoneParts(ms,state.settings.timezone).date;
    for(const series of Object.values(state.series)) {
      if(series.deleted||series.paused||series.needsReview?.length)continue;
      const from=series.from||today, until=addDays(today,state.settings.recurrenceHorizon||90);
      // Reopen after long absence: preserve a bounded 1-year lookback; do not create unbounded history.
      const begin=from<addDays(today,-366)?addDays(today,-366):from;
      for(let d=begin;d<=until;d=addDays(d,1)) {
        if(series.until&&d>series.until)break;
        const r=series.rule,wd=weekday(d),day=+d.slice(8,10),month=+d.slice(5,7),year=+d.slice(0,4);
        let yes=r.freq==='daily'||r.freq==='weekly'&&r.weekdays.includes(wd)||r.freq==='monthly'&&(r.lastDay?day===monthDays(year,month):day===r.day||(r.invalidDay==='last'&&r.day>monthDays(year,month)&&day===monthDays(year,month)));
        if(!yes)continue;
        const id=`${series.id}@${d}`;if(state.items[id])continue;
        const it=clone(series.template);it.id=id;it.seriesId=series.id;it.occurrenceDate=d;it.createdAt=ms;it.done=false;it.completedAt=null;it.children=it.children.map((x,i)=>({...x,id:`${id}:c${i}`,done:false,completedAt:null}));
        if(it.type==='task'){it.dueDate=d;it.originalDueDate=d;}
        else {it.date=d;it.endDate=d;if(it.time){it.startAt=localEpoch(d,it.time.hour,it.time.minute,it.timezone);it.final=it.startAt?finalAlarm(it.startAt,ms):null;}}
        write(state,'item',id,it,ms);
      }
    }
  }
  function createItem(state,text,ms=Date.now(),zone=state.settings.timezone,captureId=uuid()) {
    if(state.captures[captureId]) return {status:'duplicate',message:'이미 저장한 입력입니다.',ids:state.captures[captureId].itemIds||[]};
    const it=parseCreate(text,ms,zone,captureId,projectNames(state));
    write(state,'capture',captureId,{id:captureId,text,createdAt:ms,timezone:zone,status:'stored',itemIds:[]},ms);
    if(it.recurrence && !it.recurrence.unresolved.length && !it.needsReview.some(x=>['date','time','meridiem'].includes(x))) {
      const sid='series:'+captureId, rule=clone(it.recurrence);it.recurrence=null;
      write(state,'series',sid,{id:sid,rule,from:it.dueDate||it.date||zoneParts(ms,zone).date,until:null,template:it,needsReview:[],createdAt:ms,deleted:false},ms);
      ensureRecurrences(state,ms);
      const ids=Object.values(state.items).filter(x=>x.seriesId===sid).map(x=>x.id);
      write(state,'capture',captureId,{itemIds:ids,status:'parsed'},ms);
      return {status:'saved',message:`반복 ${it.type==='event'?'약속':'할 일'}을 저장했어요. ${it.project?'':'분류는 확인 필요함에 모아둘게요.'}`,ids,seriesId:sid};
    }
    write(state,'item',it.id,it,ms);write(state,'capture',captureId,{itemIds:[it.id],status:'parsed'},ms);
    return {status:'saved',message:it.needsReview.length?'먼저 저장했어요. 애매한 부분은 확인 필요함에 모아둘게요.':`${it.project}에 ${it.type==='task'?'할 일':it.type==='event'?'약속':it.type==='reference'?'참고 일정':'기록'}을 저장했어요.`,ids:[it.id]};
  }
  function normalize(s){return s.toLowerCase().replace(/폴더들/g,'폴더').replace(/(?:하기|해줘|해주세요|했어|끝났어|완료|등록|하는\s*거|하는\s*것)/g,'').replace(/[\s.,!?~'"]/g,'').replace(/[은는이가을를에]$/,'');}
  function matchItems(state,query) {
    const q=normalize(query);if(!q)return [];
    const all=Object.values(state.items).filter(x=>!x.deleted&&!x.done),exact=all.filter(x=>normalize(x.title)===q);
    if(exact.length)return exact;
    return all.filter(x=>{const n=normalize(x.title);return n.length>1&&(n.includes(q)||q.includes(n));});
  }
  function updateItem(state,id,patch,ms=Date.now()) {
    const it=state.items[id];if(!it||it.deleted)throw new Error('기록을 찾지 못했습니다.');
    if(patch.project!==undefined&&patch.project!==null&&!projectNames(state).includes(patch.project))throw new Error('프로젝트를 확인해주세요.');
    if(patch.type&&!TYPES.includes(patch.type))throw new Error('기록 종류를 확인해주세요.');
    for(const k of ['dueDate','originalDueDate','plannedDate','date','endDate'])if(patch[k]&&!validDate(patch[k]))throw new Error('날짜를 확인해주세요.');
    if(patch.startAt!==undefined && patch.startAt!==it.startAt) {patch={...patch,startVersion:it.startVersion+1,final:patch.startAt?finalAlarm(patch.startAt,ms):null};}
    const merged={...it,...patch};
    if(merged.type!=='task'){patch.done=false;patch.completedAt=null;patch.dueDate=null;patch.plannedDate=null;}
    if(merged.type!=='event'){patch.final=null;patch.startAt=null;}
    return write(state,'item',id,{...patch,updatedAt:ms},ms);
  }
  function complete(state,id,done=true,force=false,ms=Date.now()) {
    const it=state.items[id];if(!it||it.type!=='task')return {status:'error',message:'완료 체크는 할 일에만 사용합니다.'};
    if(done&&!force&&it.children.some(x=>!x.done))return {status:'confirm',message:'끝나지 않은 하위 항목이 있어요. 전체 완료할까요?',action:{kind:'complete',id,done:true,force:true}};
    const patch={done,completedAt:done?ms:null};if(done&&force)patch.children=it.children.map(x=>({...x,done:true,completedAt:x.completedAt||ms}));
    if(!done&&it.children.length&&it.children.every(x=>x.done))patch.children=it.children.map(x=>({...x,done:false,completedAt:null}));
    updateItem(state,id,patch,ms);return {status:'updated',message:done?'완료로 표시했어요. 완료 기록에 남겨둘게요.':'다시 할 일로 열었어요.',ids:[id]};
  }
  function toggleChild(state,id,childId,done,ms=Date.now()) {
    const it=state.items[id];if(!it||it.type!=='task')throw new Error('하위 항목은 할 일에서만 사용합니다.');
    if(!it.children.some(x=>x.id===childId))throw new Error('하위 항목을 찾지 못했습니다.');
    const children=it.children.map(x=>x.id===childId?{...x,done,completedAt:done?ms:null}:x);
    const patch={children};if(state.settings.autoParent){patch.done=children.every(x=>x.done);patch.completedAt=patch.done?ms:null;}
    return updateItem(state,id,patch,ms);
  }
  function addChildren(state,id,titles,ms=Date.now()) {
    const it=state.items[id];if(!it||it.type!=='task')throw new Error('상위 할 일을 확인해주세요.');
    return updateItem(state,id,{children:[...it.children,...titles.filter(Boolean).map(title=>({id:uuid(),title:title.trim(),done:false,completedAt:null}))],done:false,completedAt:null},ms);
  }
  function postpone(state,ids,date,ms=Date.now()) {if(!validDate(date))throw new Error('날짜를 확인해주세요.');ids.forEach(id=>{if(state.items[id]?.type==='task')updateItem(state,id,{plannedDate:date},ms);});return {status:'updated',message:`${ids.length}개 일을 ${date}에 할 예정으로 옮겼어요. 원래 마감일은 보존했어요.`,ids};}
  function activeItems(state){return Object.values(state.items).filter(x=>!x.deleted);}
  function todayView(state,ms=Date.now()) {
    const d=zoneParts(ms,state.settings.timezone).date, all=activeItems(state);
    return {date:d,tasks:all.filter(x=>x.type==='task'&&!x.done&&(x.plannedDate||x.dueDate)===d),
      overdue:all.filter(x=>x.type==='task'&&!x.done&&(x.plannedDate||x.dueDate)&& (x.plannedDate||x.dueDate)<d),
      undated:all.filter(x=>x.type==='task'&&!x.done&&!x.dueDate&&!x.plannedDate),
      events:all.filter(x=>(x.type==='event'||x.type==='reference')&&x.date<=d&&(x.endDate||x.date)>=d),
      review:all.filter(x=>x.needsReview?.length),reports:Object.values(state.reports).filter(x=>!x.deleted&&zoneParts(x.receivedAt||x.createdAt,state.settings.timezone).date===d)};
  }
  function noonItems(state,ms=Date.now()) {const day=zoneParts(ms,state.settings.timezone).date, end=addDays(day,2);return activeItems(state).filter(x=>x.type==='event'&&x.startAt>ms&&zoneParts(x.startAt,state.settings.timezone).date<=end).sort((a,b)=>a.startAt-b.startAt);}
  function notificationId(it){return `event:${it.id}:v${it.startVersion}:final`;}
  function schedulePlan(state,ms=Date.now()) {
    const out=[];
    activeItems(state).filter(x=>x.type==='event'&&x.final&&x.startAt>ms).forEach(it=>{const id=notificationId(it);if(!state.receipts[id])out.push({id,kind:'final',itemId:it.id,at:Math.max(ms,it.final.at),originalAt:it.final.at,startAt:it.startAt,title:it.title,body:`${it.title}. ${formatTime(it.startAt,it.timezone)} 시작입니다.`,late:it.final.at<ms});});
    return out.sort((a,b)=>a.at-b.at);
  }
  function dailyNotice(state,kind,ms=Date.now()) {
    const v=todayView(state,ms), id=`daily:${v.date}:${kind}`, nl='\n';let body,title;
    if(kind==='morning'){title='오전 10시 · 오늘의 브리핑';body=`오늘 할 일 ${v.tasks.length}개, 일정 ${v.events.length}개입니다.`+nl+v.tasks.map(x=>'• '+x.title).join(nl)+nl+v.events.map(x=>'• '+x.title+(x.startAt?' '+formatTime(x.startAt,state.settings.timezone):' 참고 일정')).join(nl)+nl+`지난 일 ${v.overdue.length}개, 날짜 없는 일 ${v.undated.length}개, 오늘 받은 보고 ${v.reports.length}개가 있습니다.`;}
    else if(kind==='noon'){const events=noonItems(state,ms);if(!events.length)return null;title='낮 12시 · 다가오는 약속';body=events.map(x=>`${x.title}. ${formatTime(x.startAt,state.settings.timezone)}.`).join(nl);}
    else{title='저녁 8시 · 하루 마무리';body=`오늘 남은 일 ${v.tasks.length}개, 미룬 일 ${v.overdue.length}개, 확인할 기록 ${v.review.length}개입니다.`+nl+v.tasks.concat(v.overdue).slice(0,15).map(x=>'• '+x.title).join(nl)+nl+'일정을 바꾸려면 재배치 제안을 확인하고 승인해주세요.';}
    return {id,kind,title,body,at:ms};
  }
  function acknowledge(state,id,ms=Date.now()) {if(!state.receipts[id])write(state,'receipt',id,{id,readAt:ms,device:state.deviceId},ms);return state.receipts[id];}
  function formatTime(ms,zone){return new Intl.DateTimeFormat('ko-KR',{timeZone:zone,month:'long',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(ms));}
  function query(state,text,ms=Date.now()) {
    let all=activeItems(state),m;
    if(/하위|남은|아직.*(?:안|않)/.test(text)&&/에서/.test(text)){
      const target=matchItems(state,text.split('에서')[0]);if(target.length!==1)return {status:'ambiguous',message:'어느 할 일의 하위 항목인지 확인해주세요.',ids:target.map(x=>x.id)};
      const sub=target[0].children.filter(x=>!x.done);return {status:'answer',message:sub.length?sub.map(x=>x.title).join(', '):'하위 항목이 모두 끝났어요.',ids:[target[0].id]};
    }
    let extra='';
    if(/오늘/.test(text)){const v=todayView(state,ms);all=v.tasks.concat(v.events);
      // Today's list stays exact; overdue and undated work is pointed to, not silently merged in.
      const notes=[];if(v.overdue.length)notes.push(`지난 할 일 ${v.overdue.length}개`);if(v.undated.length)notes.push(`기한 없는 할 일 ${v.undated.length}개`);if(notes.length)extra='\n'+notes.join(' · ')+'도 있어요.';}
    else if(/(?:이번|다음)\s*주/.test(text)&&!/[월화수목금토일]{1,7}요일|(?:이번|다음)\s*주\s*[월화수목금토일]/.test(text)){
      const today=zoneParts(ms,state.settings.timezone).date,monday=addDays(today,-((weekday(today)+6)%7)+(/다음\s*주/.test(text)?7:0)),sunday=addDays(monday,6);
      all=all.filter(x=>{const d=x.plannedDate||x.dueDate||x.date;return d&&d>=monday&&d<=sunday;});}
    else if(/내일|요일|다음\s*주/.test(text)) {const dt=dateParse(text,ms,state.settings.timezone);if(dt.date)all=all.filter(x=>(x.plannedDate||x.dueDate||x.date)===dt.date);}
    if(/완료|끝낸/.test(text))all=all.filter(x=>x.type==='task'&&x.done);else if(/할\s*일|해야/.test(text))all=all.filter(x=>x.type==='task'&&!x.done);
    for(const h of ['책','영화','음악'])if(text.includes(h))all=all.filter(x=>x.hobby===h||x.title.includes(h));
    const project=projectNames(state).find(p=>text.toLowerCase().includes(p.toLowerCase()));if(project)all=all.filter(x=>x.project===project);
    if(/(?:찾아|검색)/.test(text)){const term=text.replace(/찾아줘|찾아|검색해줘|검색/g,'').trim();all=all.filter(x=>(x.title+' '+x.body).includes(term));}
    if(/예비군/.test(text))all=all.filter(x=>x.title.includes('예비군'));
    all.sort((a,b)=>String(a.plannedDate||a.dueDate||a.date||'9999').localeCompare(String(b.plannedDate||b.dueDate||b.date||'9999')));
    const ids=all.slice(0,30).map(x=>x.id);return {status:'answer',message:(all.length?`${all.length}개 기록을 찾았어요.\n`+all.slice(0,8).map(x=>'• '+x.title+(x.plannedDate||x.dueDate||x.date?' · '+(x.plannedDate||x.dueDate||x.date):'')).join('\n'):'조건에 맞는 기록이 없어요.')+extra,ids};
  }
  function execute(state,text,ms=Date.now(),zone=state.settings.timezone,captureId=uuid()) {
    text=String(text||'').trim();if(!text)return {status:'error',message:'기록할 내용을 입력해주세요.'};if(text.length>20000)return {status:'error',message:'한 번에 20,000자까지 저장할 수 있어요.'};
    let m;
    if(/보여줘|알려줘|찾아줘|언제(?:지|야)|뭐\s*해야|검색/.test(text)&&!/(?:등록|하위.*은|까지.*알려줘)/.test(text))return query(state,text,ms);
    // Explicit checklist mutation comes before top-level complete/create.
    if((m=text.match(/^(.+?)에서\s*(.+?)\s*(?:완료(?:했어|해줘)?|끝났어|끝냈어)[.!]?$/))) {
      const targets=matchItems(state,m[1]);if(targets.length!==1)return pendingCommand(state,text,targets,ms,zone,captureId);
      const subs=targets[0].children.filter(x=>normalize(x.title)===normalize(m[2])||normalize(x.title).includes(normalize(m[2])));
      if(subs.length!==1)return pendingCommand(state,text,targets,ms,zone,captureId,'하위 항목을 특정하지 못했어요.');
      toggleChild(state,targets[0].id,subs[0].id,true,ms);return {status:'updated',message:`${subs[0].title}, 완료했어요.`,ids:[targets[0].id]};
    }
    if((m=text.match(/^(.+?)(?:에|에서)\s*(.+?)\s*(?:도\s*)?추가해(?:줘)?[.!]?$/))&&!/하위\s*항목은/.test(text)) {
      const targets=matchItems(state,m[1]);if(targets.length===1){addChildren(state,targets[0].id,[m[2].replace(/도$/,'')],ms);return {status:'updated',message:'하위 항목을 추가했어요.',ids:[targets[0].id]};}
      if(targets.length>1)return pendingCommand(state,text,targets,ms,zone,captureId);
    }
    if((m=text.match(/^(.+?)\s*(?:다시\s*열어(?:줘|주세요)?|완료\s*취소(?:해줘|해주세요)?|미완료로\s*(?:바꿔줘|돌려줘))[.!]?$/))) {
      const q=normalize(m[1]),done=Object.values(state.items).filter(x=>!x.deleted&&x.type==='task'&&x.done);
      let targets=done.filter(x=>normalize(x.title)===q);if(!targets.length)targets=done.filter(x=>{const n=normalize(x.title);return n.length>1&&(n.includes(q)||q.includes(n));});
      if(targets.length!==1)return pendingCommand(state,text,targets,ms,zone,captureId);
      return complete(state,targets[0].id,false,false,ms);
    }
    if((m=text.match(/^(.+?)\s*(?:완료(?:해줘|했어|처리해줘)?|끝났어|끝냈어)[.!]?$/))) {
      const targets=matchItems(state,m[1]);if(targets.length!==1)return pendingCommand(state,text,targets,ms,zone,captureId);
      return complete(state,targets[0].id,true,false,ms);
    }
    // "이번 주만 금요일로" / "앞으로 매주 금요일로" carry no verb; they are a change only when an existing item matches.
    const shortMove=!/미뤄|옮겨|바꿔/.test(text)&&/(?:이번\s*주만|앞으로)/.test(text)&&/(?:으로|로)\s*(?:해\s*줘|해\s*주세요|변경(?:해줘)?)?[.!]?$/.test(text)
      &&(()=>{const cut=text.search(/(?:이번\s*주만|앞으로)/);return cut>0&&matchItems(state,text.slice(0,cut).replace(/(?:거|것|을|를|은|는)\s*$/,'').trim()).length>0;})();
    if(/미뤄|옮겨|바꿔/.test(text)||shortMove) {
      const dt=dateParse(text,ms,zone), cut=text.search(/(?:이번\s*주만|앞으로|다음\s*주|이번\s*주|내일|모레|글피|오늘|[월화수목금토일]요일|\d{1,2}월)/);
      const name=cut>0?text.slice(0,cut).replace(/(?:거|것|을|를)\s*$/,'').trim():text.replace(/(?:으로|로)?\s*(?:미뤄줘|옮겨줘|바꿔줘).*/,'');
      let targets=matchItems(state,name);
      const sids=[...new Set(targets.map(x=>x.seriesId).filter(Boolean))];
      if(/앞으로/.test(text)&&sids.length===1&&targets.every(x=>x.seriesId===sids[0])){
        const r=recurrenceParse(text);if(r&&!r.unresolved.length)return changeSeries(state,sids[0],r,ms);
      }
      if(/이번\s*주만/.test(text)){
        const today=zoneParts(ms,zone).date, monday=addDays(today,-((weekday(today)+6)%7)), sunday=addDays(monday,6);
        targets=targets.filter(x=>!x.done&&x.seriesId&&x.occurrenceDate>=monday&&x.occurrenceDate<=sunday);
      }
      if(targets.length!==1)return pendingCommand(state,text,targets,ms,zone,captureId);
      if(dt.date){if(targets[0].type==='task')return postpone(state,[targets[0].id],dt.date,ms);
        const time=dt.time||targets[0].time;if(targets[0].type==='event'&&time){const start=localEpoch(dt.date,time.hour,time.minute,zone);updateItem(state,targets[0].id,{date:dt.date,endDate:dt.date,startAt:start,time},ms);return {status:'updated',message:'약속 시간과 최종 알림을 변경했어요.',ids:[targets[0].id]};}}
      const project=classify(text,projectNames(state));if(project){updateItem(state,targets[0].id,{project,needsReview:targets[0].needsReview.filter(x=>x!=='project')},ms);return {status:'updated',message:`${project}로 옮겼어요.`,ids:[targets[0].id]};}
      return pendingCommand(state,text,targets,ms,zone,captureId,'변경할 날짜나 분류를 확인해야 해요.');
    }
    // Destructive commands are never interpreted as fresh tasks or executed from loose text.
    if(/삭제해|전부\s*지워|설정.*변경|실행해/.test(text))return pendingCommand(state,text,[],ms,zone,captureId,'이 변경은 기록 화면에서 대상을 확인해주세요.');
    return createItem(state,text,ms,zone,captureId);
  }
  function pendingCommand(state,text,targets,ms,zone,id,message) {
    if(!state.captures[id])write(state,'capture',id,{id,text,createdAt:ms,timezone:zone,status:'needs_confirmation',itemIds:targets.map(x=>x.id)},ms);
    return {status:'ambiguous',message:message||'대상을 하나로 정할 수 없어 변경하지 않았어요. 확인 필요함에 모아둘게요.',ids:targets.map(x=>x.id),captureId:id};
  }
  function changeSeries(state,id,rule,ms=Date.now()) {
    const s=state.series[id];if(!s)throw new Error('반복 원본을 찾지 못했어요.');const today=zoneParts(ms,state.settings.timezone).date;
    write(state,'series',id,{until:addDays(today,-1)},ms);
    Object.values(state.items).filter(x=>x.seriesId===id&&!x.done&&x.occurrenceDate>=today).forEach(x=>updateItem(state,x.id,{deleted:true},ms));
    const sid='series:'+uuid();write(state,'series',sid,{...clone(s),id:sid,rule,from:today,until:null},ms);ensureRecurrences(state,ms);
    return {status:'updated',message:'지난 완료 기록은 남기고 앞으로의 반복 일정을 바꿨어요.',seriesId:sid};
  }
  function resolveRecurrence(state,id,rule,ms=Date.now()) {
    const it=state.items[id];if(!it||!it.recurrence)throw new Error('반복 확인 대상이 아닙니다.');
    const sid='series:'+it.id;const t=clone(it);t.recurrence=null;t.needsReview=t.needsReview.filter(x=>!['repeatWeekday','repeatDay','monthlyPolicy'].includes(x));
    write(state,'series',sid,{id:sid,rule,from:it.dueDate||it.date||zoneParts(ms,state.settings.timezone).date,until:null,template:t,needsReview:[],deleted:false,createdAt:ms},ms);
    updateItem(state,id,{deleted:true},ms);ensureRecurrences(state,ms);return sid;
  }
  function applySync(state,response,sentIds,ms=Date.now()) {
    const sent=new Set(sentIds),accepted=new Set((response.accepted||[]).map(x=>typeof x==='string'?x:x.opId));
    const rejected=new Set((response.conflicts||[]).map(x=>x.opId));
    state.ops=state.ops.filter(x=>!(sent.has(x.opId)&&(accepted.has(x.opId)||rejected.has(x.opId))));
    for(const c of response.conflicts||[]) if(!state.conflicts.some(x=>x.opId===c.opId))state.conflicts.push(c);
    const dirty=new Set(state.ops.map(x=>x.entity+':'+x.id));
    for(const change of response.changes||[]) {
      const bucket=containerFor(state,change.entity),value=change.value;
      if(change.entity==='receipt') {if(value.readAt&&(!bucket[change.id]||bucket[change.id].readAt>value.readAt))bucket[change.id]=clone(value);}
      else if(!dirty.has(change.entity+':'+change.id))bucket[change.id]=clone(value);
    }
    state.cursor=response.cursor;state.lastSync=ms;return state;
  }
  function resolveConflict(state,opId,choice,ms=Date.now()) {
    const conflict=state.conflicts.find(x=>x.opId===opId);if(!conflict)return;
    const op=conflict.operation;containerFor(state,op.entity)[op.id]=clone(conflict.current);
    if(choice==='local')write(state,op.entity,op.id,op.patch,ms);
    state.conflicts=state.conflicts.filter(x=>x.opId!==opId);
  }
  function mergeBackup(state,other,ms=Date.now()) {
    if(other.schema!==1)throw new Error('지원하지 않는 백업 형식입니다.');
    for(const [entity,bucket] of [['item','items'],['series','series'],['capture','captures'],['report','reports'],['receipt','receipts']]){
      for(const [id,v] of Object.entries(other[bucket]||{})){if(!state[bucket][id])write(state,entity,id,v,ms);else if(!same(state[bucket][id],v))state.conflicts.push({opId:uuid(),operation:{entity,id,patch:v},current:clone(state[bucket][id]),fields:['backup'],reason:'백업과 현재 기록이 다릅니다.'});}
    }return state;
  }
  return {VERSION,PROJECTS,STARTER_PROJECTS,adoptOwnerProjects,PROJECT_ICONS,projectList,projectNames,ensureProjects,addProject,renameProject,setProjectIcon,deleteProject,TYPES,DAY,MINUTE,uuid,clone,same,zoneParts,validDate,addDays,weekday,monthDays,localEpoch,finalAlarm,dateParse,recurrenceParse,classify,parseCreate,titleOf,emptyState,write,createItem,execute,query,updateItem,complete,toggleChild,addChildren,postpone,ensureRecurrences,resolveRecurrence,changeSeries,activeItems,todayView,noonItems,schedulePlan,dailyNotice,acknowledge,notificationId,formatTime,applySync,resolveConflict,mergeBackup,matchItems};
});
