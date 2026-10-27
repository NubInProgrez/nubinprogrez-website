const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function visibleAudioDuration(layer,duration){return Math.max(0,Math.min(layer.end-layer.start,duration-layer.offset))}
export function normalizeAudioLayer(layer,duration){
 const minimum=Math.min(.01,layer.duration),maxOffset=Math.max(0,duration-.01);
 const start=clamp(Number(layer.start)||0,0,Math.max(0,layer.duration-minimum));
 return {...layer,offset:clamp(Number(layer.offset)||0,0,maxOffset),start,end:clamp(Number(layer.end)||minimum,start+minimum,layer.duration),volume:clamp(Number(layer.volume)||0,0,200)};
}
function metadata(audio,url){
 return new Promise((resolve,reject)=>{
  const finish=(error)=>{clearTimeout(timer);audio.onloadedmetadata=null;audio.onerror=null;error?reject(error):resolve(audio.duration)};
  const timer=setTimeout(()=>finish(Error('No se pudo leer la duración del audio.')),8000);
  audio.onloadedmetadata=()=>Number.isFinite(audio.duration)&&audio.duration>0?finish():finish(Error('El audio no tiene una duración válida.'));
  audio.onerror=()=>finish(Error('Este formato de audio no tiene vista previa en el navegador.'));
  audio.src=url;audio.load();
 });
}
export class AudioLayers{
 constructor({panel,lanes,getContext,onSelect,onChange,onInteraction,onError,inspectFile}){
  Object.assign(this,{panel,lanes,getContext,onSelect,onChange,onInteraction,onError,inspectFile});this.items=[];this.selected=null;this.duration=0;this.disabled=false;this.serial=0;this.drag=null;this.revision=0;
  panel.innerHTML=`<div class="layer-divider"></div><div class="layer-heading"><strong>Audios añadidos</strong><button type="button" id="add-audio-layer">+ Añadir audio</button><input id="audio-layer-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.aiff,.wma" multiple hidden></div><p class="layer-hint">Arrastra cada pista para colocarla. Los tiempos se refieren al archivo principal, antes del recorte.</p>
   <div id="layer-controls" hidden><label class="control">Pista<select id="layer-select"></select></label><label class="control">Posición de entrada (s)<input id="layer-offset" type="number" min="0" step="0.01"></label><div class="two"><label>Inicio del audio (s)<input id="layer-start" type="number" min="0" step="0.01"></label><label>Fin del audio (s)<input id="layer-end" type="number" min="0" step="0.01"></label></div><label class="control layer-volume-control">Volumen de esta pista <output id="layer-volume-value">100%</output><input id="layer-volume" type="range" min="0" max="200" value="100"></label><label class="check"><input id="layer-muted" type="checkbox"> Silenciar esta pista</label><div class="layer-actions"><output id="layer-length"></output><button id="remove-audio-layer" type="button">Quitar pista</button></div></div>`;
  this.$=id=>panel.querySelector('#'+id);
  this.$('layer-select').onchange=()=>this.select(Number(this.$('layer-select').value));
  for(const key of ['offset','start','end','volume'])this.$('layer-'+key).addEventListener('input',()=>this.edit(key,Number(this.$('layer-'+key).value)));
  for(const key of ['offset','start','end'])this.$('layer-'+key).addEventListener('change',()=>this.paintControls());
  this.$('layer-muted').onchange=()=>this.edit('muted',this.$('layer-muted').checked);
  this.$('remove-audio-layer').onclick=()=>this.remove(this.selected);
  lanes.innerHTML='<div class="audio-lanes-heading"><span>AUDIOS AÑADIDOS</span><span>Arrastra para colocar · bordes para recortar</span></div><div class="audio-lanes-list"></div>';
  this.list=lanes.querySelector('.audio-lanes-list');
  this.resizeObserver=new ResizeObserver(()=>this.paintWaves());this.resizeObserver.observe(lanes);
 }
 setDuration(duration){this.duration=duration}
 async add(file,offset=0){
  if(this.items.length>=6)throw Error('Puedes añadir hasta seis pistas de audio.');
  const revision=this.revision,url=URL.createObjectURL(file),audio=new Audio();audio.preload='auto';let duration,preview=true;
  try{try{duration=await metadata(audio,url)}catch(e){if(!this.inspectFile)throw e;const info=await this.inspectFile(file);if(!info.hasAudio)throw Error('El archivo no contiene audio.');duration=info.duration;preview=false}
   if(revision!==this.revision){URL.revokeObjectURL(url);return}
   if(this.duration-offset<.05)offset=0;
   const item=normalizeAudioLayer({id:++this.serial,file,url,audio,duration,offset,start:0,end:duration,volume:100,muted:false,preview,wave:null,node:null,gain:null,playPending:false,errorShown:false},this.duration);
   this.items.push(item);this.selected=item.id;this.render();this.onChange?.();this.decodeWave(item);return item;
  }catch(e){audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);throw e}
 }
 async decodeWave(item){
  if(!item.preview||item.file.size>10*1024*1024||item.duration>300)return;
  try{const buffer=await this.getContext().decodeAudioData(await item.file.arrayBuffer());if(!this.items.includes(item))return;const samples=buffer.getChannelData(0),bins=500;
   item.wave=Array.from({length:bins},(_,i)=>{let peak=0;const a=Math.floor(i*samples.length/bins),b=Math.floor((i+1)*samples.length/bins),step=Math.max(1,Math.floor((b-a)/70));for(let j=a;j<b;j+=step)peak=Math.max(peak,Math.abs(samples[j]));return peak});this.paintWaves();
  }catch{/* The clip and preview remain usable without waveform decoding. */}
 }
 select(id){this.selected=id;this.paintControls();this.paintPositions();this.onSelect?.()}
 edit(key,value){
  const item=this.items.find(i=>i.id===this.selected);if(!item||this.disabled)return;
  let next={...item,[key]:value};
  if(key==='start')next.start=clamp(value,0,Math.max(0,item.end-.01));if(key==='end')next.end=clamp(value,item.start+.01,item.duration);
  Object.assign(item,normalizeAudioLayer(next,this.duration));this.paintPositions();this.paintWaves();this.$('layer-volume-value').textContent=item.volume+'%';this.$('layer-length').textContent=visibleAudioDuration(item,this.duration).toFixed(2)+' s audibles';this.onChange?.();
 }
 remove(id){const at=this.items.findIndex(i=>i.id===id);if(at<0)return;this.release(this.items[at]);this.items.splice(at,1);this.selected=this.items[0]?.id??null;this.render();this.onChange?.()}
 release(item){item.audio.pause();item.audio.removeAttribute('src');item.audio.load();item.node?.disconnect();item.gain?.disconnect();URL.revokeObjectURL(item.url)}
 clear(){this.revision++;for(const item of this.items)this.release(item);this.items=[];this.selected=null;this.render()}
 setDisabled(value){this.disabled=value;this.panel.querySelectorAll('input,button,select').forEach(el=>el.disabled=value);this.list.querySelectorAll('[tabindex]').forEach(el=>{el.tabIndex=value?-1:0;el.setAttribute('aria-disabled',String(value))});if(value)this.pause()}
 getExportLayers(){return this.items.map(({id,file,offset,start,end,volume,muted})=>({id,file,offset,start,end,volume,muted}))}
 paintControls(){
  const item=this.items.find(i=>i.id===this.selected);this.$('layer-controls').hidden=!item;if(!item)return;
  this.$('layer-select').value=item.id;
  for(const key of ['offset','start','end','volume'])this.$('layer-'+key).value=Number(item[key].toFixed(3));
  this.$('layer-offset').max=Math.max(0,this.duration-.01);this.$('layer-start').max=item.end;this.$('layer-end').max=item.duration;
  this.$('layer-muted').checked=item.muted;this.$('layer-volume-value').textContent=item.volume+'%';this.$('layer-length').textContent=visibleAudioDuration(item,this.duration).toFixed(2)+' s audibles';
 }
 render(){
  this.lanes.hidden=!this.items.length;this.list.replaceChildren();this.$('layer-select').replaceChildren();
  for(const item of this.items){
   this.$('layer-select').add(new Option(item.file.name,item.id));const row=document.createElement('div');row.className='audio-lane';row.dataset.id=item.id;
   const clip=document.createElement('div');clip.className='audio-layer-clip';clip.tabIndex=this.disabled?-1:0;clip.setAttribute('role','slider');clip.setAttribute('aria-label','Posición de '+item.file.name);clip.setAttribute('aria-valuemin','0');clip.setAttribute('aria-valuemax',this.duration);
   const wave=document.createElement('canvas');wave.className='layer-wave';wave.setAttribute('aria-hidden','true');const title=document.createElement('span');title.className='layer-title';title.textContent='♫ '+item.file.name;clip.append(wave,title);
   for(const edge of ['start','end']){const handle=document.createElement('div');handle.className='layer-trim layer-trim-'+edge;handle.dataset.edge=edge;handle.tabIndex=this.disabled?-1:0;handle.setAttribute('role','slider');handle.setAttribute('aria-label',(edge==='start'?'Inicio':'Fin')+' de '+item.file.name);handle.addEventListener('keydown',e=>this.key(e,item,edge));clip.append(handle)}
   item.audio.hidden=true;item.audio.className='preview-layer-audio';item.audio.setAttribute('aria-hidden','true');
   const line=document.createElement('div');line.className='audio-playline';row.append(item.audio,clip,line);this.list.append(row);item.row=row;item.clip=clip;item.canvas=wave;
   row.addEventListener('pointerdown',e=>this.begin(e,item));row.addEventListener('pointermove',e=>this.move(e));for(const event of ['pointerup','pointercancel','lostpointercapture'])row.addEventListener(event,e=>this.finish(e));
   clip.addEventListener('keydown',e=>{if(e.target===clip)this.key(e,item,'move')});clip.addEventListener('click',()=>this.select(item.id));
  }
  this.paintControls();this.paintPositions();this.paintWaves();this.setDisabled(this.disabled);
 }
 paintPositions(){
  for(const item of this.items){if(!item.clip)continue;const duration=visibleAudioDuration(item,this.duration);
   item.clip.style.left=(item.offset/this.duration*100)+'%';item.clip.style.width=(duration/this.duration*100)+'%';item.clip.classList.toggle('selected',item.id===this.selected);item.clip.classList.toggle('muted',item.muted);
   item.clip.setAttribute('aria-valuenow',item.offset.toFixed(3));item.clip.setAttribute('aria-valuetext',item.offset.toFixed(2)+' segundos');
   const handles=item.clip.querySelectorAll('.layer-trim');handles.forEach((el,i)=>{el.setAttribute('aria-valuemin',0);el.setAttribute('aria-valuemax',item.duration);el.setAttribute('aria-valuenow',(i?item.end:item.start).toFixed(3))});
   item.clip.title=`${item.file.name} · ${item.offset.toFixed(2)} s · ${item.volume}%${item.preview?'':' · sin vista previa en este navegador'}`;
  }
 }
 paintWaves(){
  for(const item of this.items){const canvas=item.canvas;if(!canvas)continue;const width=canvas.clientWidth,height=canvas.clientHeight;if(!width||!height)continue;canvas.width=Math.round(width);canvas.height=Math.round(height);const c=canvas.getContext('2d');c.clearRect(0,0,width,height);c.fillStyle='#85e6dc66';
   if(item.wave){const duration=visibleAudioDuration(item,this.duration),count=Math.ceil(width/3);for(let i=0;i<count;i++){const at=item.start+i/count*duration,index=Math.min(item.wave.length-1,Math.floor(at/item.duration*item.wave.length)),h=Math.max(2,item.wave[index]*(height-3));c.fillRect(i*3,height/2-h/2,2,h)}}
   else c.fillRect(0,height/2,width,1);
  }
 }
 begin(e,item){
  if(this.disabled||e.button!==0||!e.target.closest('.audio-layer-clip'))return;e.preventDefault();this.onInteraction?.();this.select(item.id);const edge=e.target.closest('[data-edge]')?.dataset.edge||'move';
  this.drag={id:e.pointerId,item,edge,clientX:e.clientX,original:{offset:item.offset,start:item.start,end:item.end},width:item.row.getBoundingClientRect().width};item.row.setPointerCapture(e.pointerId);item.clip.focus({preventScroll:true});
 }
 move(e){if(!this.drag||e.pointerId!==this.drag.id)return;const d=this.drag,delta=(e.clientX-d.clientX)/d.width*this.duration;this.apply(d.item,d.edge,delta,d.original)}
 apply(item,edge,delta,original){
  if(edge==='move')item.offset=clamp(original.offset+delta,0,Math.max(0,this.duration-.01));
  else if(edge==='start'){const amount=clamp(delta,Math.max(-original.offset,-original.start),Math.min(original.end-original.start-.01,this.duration-original.offset-.01));item.offset=original.offset+amount;item.start=original.start+amount}
  else item.end=clamp(original.start+visibleAudioDuration({...item,...original},this.duration)+delta,original.start+.01,item.duration);
  Object.assign(item,normalizeAudioLayer(item,this.duration));this.paintPositions();this.paintWaves();this.paintControls();this.onChange?.();
 }
 finish(e){if(!this.drag||e.pointerId!==this.drag.id)return;const d=this.drag;this.drag=null;if(d.item.row.hasPointerCapture(d.id))d.item.row.releasePointerCapture(d.id)}
 key(e,item,edge){let delta=e.altKey ? .01 : e.shiftKey ? 1 : .1;if(e.key==='ArrowLeft')delta=-delta;else if(e.key!=='ArrowRight')return;e.preventDefault();e.stopPropagation();this.onInteraction?.();this.select(item.id);this.apply(item,edge,delta,{offset:item.offset,start:item.start,end:item.end})}
 resume(){this.getContext().resume().catch(()=>{})}
 pause(){for(const item of this.items)item.audio.pause()}
 sync(time,playing,speed=1){
  this.lanes.style.setProperty('--audio-position',(this.duration?clamp(time/this.duration,0,1)*100:0)+'%');
  for(const item of this.items){const local=time-item.offset,active=!this.disabled&&!item.muted&&item.preview&&local>=0&&local<item.end-item.start&&time<this.duration;
   if(!active||!playing){if(!item.audio.paused)item.audio.pause();continue}
   try{if(!item.node){const context=this.getContext();item.node=context.createMediaElementSource(item.audio);item.gain=context.createGain();item.node.connect(item.gain).connect(context.destination)}item.gain.gain.value=item.volume/100;if(item.audio.playbackRate!==speed)item.audio.playbackRate=speed;
    const target=item.start+local;if(Math.abs(item.audio.currentTime-target)>.08)item.audio.currentTime=target;
    if(item.audio.paused&&!item.playPending){item.playPending=true;item.audio.play().catch(error=>{if(error.name!=='AbortError'&&this.items.includes(item)&&!item.errorShown){item.errorShown=true;this.onError?.('No se pudo reproducir una pista añadida. Puedes exportar para escuchar la mezcla.')}}).finally(()=>item.playPending=false)}
   }catch{/* Some codecs can be exported even when native preview is unavailable. */}
  }
 }
 destroy(){this.clear();this.resizeObserver.disconnect()}
}
