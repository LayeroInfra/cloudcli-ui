(function () {
const panel=document.createElement('aside');
panel.id='project-preview';
panel.setAttribute('aria-label','Предпросмотр сайта');
function el(tag,text=''){const n=document.createElement(tag);n.textContent=text;return n}
function btn(label,fn){const n=el('button',label);n.type='button';n.onclick=fn;return n}
const header=el('header'),strip=el('nav'),form=el('form'),input=el('input');
strip.setAttribute('aria-label','Вкладки предпросмотра');
input.setAttribute('aria-label','Адрес предпросмотра');
input.spellcheck=false;
input.autocomplete='off';
const initial='http://localhost:8080/';
const ports={'8080':'8080','15173':'15173','5173':'15173'};
const tabs=[];
let active;
function normalize(text){
  text=text.trim();
  const url=new URL(/^(localhost|127\.0\.0\.1):/i.test(text)?'http://'+text:text);
  if(url.protocol!=='http:'||url.username||url.password||!['localhost','127.0.0.1'].includes(url.hostname)||!ports[url.port]) throw Error();
  url.hostname='localhost';url.port=ports[url.port];return url.href;
}
function select(tab){
  active=tab;
  for(const item of tabs){
    item.frame.hidden=item!==tab;
    item.pick.setAttribute('aria-pressed',String(item===tab));
  }
  input.value=tab.url; input.setCustomValidity('');
  sessionStorage.setItem('tashkent-preview-tabs',JSON.stringify({urls:tabs.map(t=>t.url),index:tabs.indexOf(tab)}));
}
function navigate(tab,url){
  tab.url=url;tab.frame.src=url;
  const u=new URL(url);
  tab.pick.textContent=u.host+(u.pathname==='/'?'':u.pathname);
  tab.pick.title=url;tab.close.setAttribute('aria-label','Закрыть вкладку '+u.host+u.pathname);
  select(tab);
}
function add(url){
  const tab={group:el('span'),frame:el('iframe')};
  tab.pick=btn('',()=>select(tab));
  tab.close=btn('×',()=>{
    const i=tabs.indexOf(tab); tabs.splice(i,1);tab.group.remove();tab.frame.remove();
    if(!tabs.length){show(false);add(initial)}
    else select(active===tab?tabs[Math.min(i,tabs.length-1)]:active);
  });
  tab.frame.title='Стенд разработки';
  tab.frame.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin');
  tab.frame.referrerPolicy='no-referrer';
  tab.group.append(tab.pick,tab.close);strip.insertBefore(tab.group,plus);
  panel.append(tab.frame);tabs.push(tab);navigate(tab,url);
}
function show(open){
  panel.hidden=!open;toggle.hidden=open;
  document.body.classList.toggle('project-preview-open',open);
  localStorage.setItem('tashkent-preview-open',open?'1':'0');
}
const plus=btn('+',()=>{add(initial);input.focus();input.select()});
plus.setAttribute('aria-label','Новая вкладка');strip.append(plus);
const toggle=btn('Предпросмотр',()=>show(true));toggle.id='project-preview-toggle';
header.append(el('strong','Предпросмотр'),btn('Обновить',()=>navigate(active,active.url)),btn('Закрыть',()=>show(false)));
form.append(input,el('button','Перейти'));panel.append(header,strip,form);document.body.append(panel,toggle);
input.oninput=()=>input.setCustomValidity('');
form.onsubmit=e=>{e.preventDefault();try{navigate(active,normalize(input.value))}catch{input.setCustomValidity('Доступны адреса localhost на портах 8080, 5173 и 15173.');input.reportValidity()}};
document.addEventListener('click',e=>{
  const a=e.target.closest?.('a[href]');if(!a)return;
  let url;try{url=normalize(a.href)}catch{return}
  e.preventDefault();e.stopImmediatePropagation();
  const tab=tabs.find(t=>t.url===url);if(tab)select(tab);else add(url);show(true);
},true);
let saved;try{saved=JSON.parse(sessionStorage.getItem('tashkent-preview-tabs'))}catch{}
for(const url of saved?.urls||[]){try{add(normalize(url))}catch{}}
if(!tabs.length)add(initial);
select(tabs[saved?.index]||tabs[0]);
show(Boolean(localStorage.getItem('auth-token'))&&localStorage.getItem('tashkent-preview-open')!=='0');

if (panel) {
  const handle = document.createElement('div');
  handle.id = 'preview-resizer';
  handle.tabIndex = 0;
  handle.title = 'Потяните, чтобы изменить ширину';
  handle.setAttribute('role','separator');
  handle.setAttribute('aria-label','Ширина предпросмотра');
  handle.setAttribute('aria-orientation','vertical');
  handle.setAttribute('aria-valuemin','20');
  handle.setAttribute('aria-valuemax','78');
  panel.append(handle);
  const key = 'tashkent-preview-width';
  let width = Number(localStorage.getItem(key)) || 46;
  function setWidth(value) {
    width = Math.max(20, Math.min(78, value));
    document.documentElement.style.setProperty('--preview-width',width+'%');
    handle.setAttribute('aria-valuenow',String(Math.round(width)));
  }
  setWidth(width);
  handle.onpointerdown = event => {
    if(event.button !== 0) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('preview-resizing');
  };
  handle.onpointermove = event => {
    if (handle.hasPointerCapture(event.pointerId))
      setWidth(100 * (1 - event.clientX / window.innerWidth));
  };
  handle.onlostpointercapture = () => {
    document.body.classList.remove('preview-resizing');
    localStorage.setItem(key,String(width));
  };
  handle.onkeydown = event => {
    if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setWidth(width + (event.key === 'ArrowLeft' ? 2 : -2));
    localStorage.setItem(key,String(width));
  };
}

})();
