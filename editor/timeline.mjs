const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export function parseTimeCode(value){
 const parts=String(value).trim().replace(',','.').split(':');
 if(!parts.length||parts.length>3||parts.some(p=>!/^\d+(?:\.\d+)?$/.test(p)))return NaN;
 if(parts.length>1&&parts.slice(1).some(p=>Number(p)>=60))return NaN;
 return parts.reduce((seconds,p)=>seconds*60+Number(p),0);
}
export function timelineTime(n){
 const ticks=Math.round(Math.max(0,Number(n)||0)*10),seconds=Math.floor(ticks/10);
 return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}.${ticks%10}`;
}
export function trimBoundary(edge,value,start,end,duration){
 const gap=Math.min(.01,duration);
 return edge==='start'?clamp(value,0,Math.max(0,end-gap)):clamp(value,Math.min(duration,start+gap),duration);
}
// Sampling uses its own decoder. It never seeks or reloads the preview player.
function waitFor(video,event,signal,action){
 return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);error?reject(error):resolve()};
  const done=()=>finish(),failed=()=>finish(Error('No se pudieron generar las miniaturas.')),aborted=()=>finish(new DOMException('Cancelado','AbortError'));
  const timer=setTimeout(()=>finish(Error('Tiempo de lectura agotado.')),7000);
  video.addEventListener(event,done,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',aborted,{once:true});
  if(signal.aborted){aborted();return}try{action()}catch(e){finish(e)}
 });
}
export class MediaTimeline{
 constructor(root,{onSeek,onTrim,onInteraction}){
  this.root=root;this.onSeek=onSeek;this.onTrim=onTrim;this.onInteraction=onInteraction;
  this.duration=0;this.start=0;this.end=0;this.position=0;this.frames=[];this.wave=null;this.disabled=false;this.drag=null;this.removing=false;
  root.innerHTML=`<div class="timeline-caption"><span id="timeline-kind">LÍNEA DE TIEMPO</span><span id="timeline-help">Arrastra los bordes para recortar · pulsa en la tira para recorrer</span></div>
   <div class="timeline-track">
    <canvas class="filmstrip" aria-hidden="true"></canvas>
    <div class="seek-surface" role="slider" tabindex="0" aria-label="Posición de reproducción" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"></div>
    <div class="trim-mask mask-before"></div><div class="trim-mask mask-after"></div>
    <div class="selected-region"></div>
    <div class="trim-handle handle-start" role="slider" tabindex="0" aria-label="Inicio del corte" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" title="Arrastra para ajustar el inicio"></div>
    <div class="trim-handle handle-end" role="slider" tabindex="0" aria-label="Fin del corte" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" title="Arrastra para ajustar el fin"></div>
    <div class="playhead"><output class="playhead-time">00:00.0</output></div><output class="hover-time" hidden></output>
   </div><div class="timeline-ruler"><span>00:00.0</span><span class="ruler-middle"></span><span class="ruler-end"></span></div>`;
  this.track=root.querySelector('.timeline-track');this.canvas=root.querySelector('canvas');this.ctx=this.canvas.getContext('2d');
  this.seek=root.querySelector('.seek-surface');this.left=root.querySelector('.handle-start');this.right=root.querySelector('.handle-end');this.head=root.querySelector('.playhead');
  this.track.addEventListener('pointerdown',e=>this.begin(e));
  this.track.addEventListener('pointermove',e=>this.move(e));
  this.track.addEventListener('pointerup',e=>this.finish(e));this.track.addEventListener('pointercancel',e=>this.finish(e));
  this.track.addEventListener('lostpointercapture',e=>this.finish(e));
  this.track.addEventListener('pointerleave',()=>{root.querySelector('.hover-time').hidden=true});
  for(const [element,edge]of [[this.seek,'seek'],[this.left,'start'],[this.right,'end']])element.addEventListener('keydown',e=>this.key(e,edge));
  this.observer=new ResizeObserver(()=>this.drawStrip());this.observer.observe(this.track);
 }
 setDisabled(value){this.disabled=value;this.root.classList.toggle('timeline-disabled',value);for(const el of [this.seek,this.left,this.right]){el.setAttribute('aria-disabled',String(value));el.tabIndex=value?-1:0}if(value&&this.drag)this.finish({pointerId:this.drag.pointerId})}
 setSelection(start,end,remove=false){this.start=clamp(Number(start)||0,0,this.duration);this.end=clamp(Number(end)||0,this.start,this.duration);this.removing=remove;this.paint()}
 setTime(value){if(this.drag)return;this.position=clamp(value||0,0,this.duration);this.paintCursor()}
 resetSource(){this.controller?.abort();this.controller=null;this.frames=[];this.wave=null;this.duration=0;this.position=0;this.start=0;this.end=0;this.drag=null;this.drawStrip();this.paint()}
 async setSource(url,{duration,hasVideo,canPreview}){
  this.resetSource();this.duration=duration;this.end=duration;this.paint();
  this.root.querySelector('#timeline-kind').textContent=hasVideo?'VIDEO · RECORTAR':'AUDIO · RECORTAR';
  this.root.querySelector('.ruler-middle').textContent=timelineTime(duration/2);this.root.querySelector('.ruler-end').textContent=timelineTime(duration);
  const help=this.root.querySelector('#timeline-help');
  const normalHelp='Arrastra los bordes para recortar · pulsa en la tira para recorrer';
  help.textContent=normalHelp;
  if(!hasVideo||!canPreview){this.drawStrip();return}
  const controller=new AbortController();this.controller=controller;const {signal}=controller;
  const decoder=document.createElement('video');decoder.muted=true;decoder.playsInline=true;decoder.preload='auto';decoder.hidden=true;document.body.append(decoder);
  const release=()=>{decoder.pause();decoder.removeAttribute('src');decoder.load();decoder.remove()};
  help.textContent='Generando miniaturas… Puedes empezar a editar.';
  try{
   await waitFor(decoder,'loadeddata',signal,()=>{decoder.src=url;decoder.load()});
   const count=24,w=144,h=80;
   for(let i=0;i<count;i++){
    if(signal.aborted)return;
    const at=Math.min(Math.max(0,duration-.05),(i+.5)*duration/count);
    if(Math.abs(decoder.currentTime-at)>.0001)await waitFor(decoder,'seeked',signal,()=>{decoder.currentTime=at});
    if(signal.aborted)return;
    const tile=document.createElement('canvas');tile.width=w;tile.height=h;const c=tile.getContext('2d');
    const scale=Math.max(w/decoder.videoWidth,h/decoder.videoHeight),dw=decoder.videoWidth*scale,dh=decoder.videoHeight*scale;
    c.drawImage(decoder,(w-dw)/2,(h-dh)/2,dw,dh);this.frames.push(tile);this.drawStrip();
    // Give playback and pointer input priority between samples.
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }catch(e){if(!signal.aborted)help.textContent='Miniaturas no disponibles. Puedes recortar y recorrer por tiempo.'}
  finally{release();if(!signal.aborted&&this.frames.length===24)help.textContent=normalHelp}
 }
 setWave(wave){this.wave=wave;this.drawStrip()}
 drawStrip(){
  const {width,height}=this.track.getBoundingClientRect();if(!width||!height)return;
  const dpr=Math.min(2,window.devicePixelRatio||1);this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
  const c=this.ctx;c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#1c2443';c.fillRect(0,0,width,height);
  if(this.frames.length){
   const count=Math.max(1,Math.ceil(width/100)),tileWidth=width/count;
   for(let i=0;i<count;i++){
    const index=Math.min(23,Math.floor((i+.5)/count*24));const frame=this.frames[index];
    if(frame)c.drawImage(frame,i*tileWidth,0,tileWidth+1,height);
   }
  }else if(this.wave){
   c.fillStyle='#94a4ec';const count=Math.floor(width/3);for(let i=0;i<count;i++){const n=this.wave[Math.min(this.wave.length-1,Math.floor(i/count*this.wave.length))];const h=Math.max(2,n*(height-10));c.fillRect(i*3,height/2-h/2,2,h)}
  }else{
   c.strokeStyle='#384368';c.lineWidth=1;c.beginPath();c.moveTo(0,height/2);c.lineTo(width,height/2);c.stroke();
   for(let x=0;x<width;x+=100){c.fillStyle='#252f51';c.fillRect(x,0,1,height)}
  }
 }
 paint(){
  const pct=n=>this.duration?n/this.duration*100:0,left=pct(this.start),right=pct(this.end);
  this.left.style.left=left+'%';this.right.style.left=right+'%';const region=this.root.querySelector('.selected-region');region.style.left=left+'%';region.style.width=(right-left)+'%';
  this.root.querySelector('.mask-before').style.width=left+'%';this.root.querySelector('.mask-after').style.width=(100-right)+'%';this.root.classList.toggle('remove-mode',this.removing);
  for(const [el,value,min,max]of [[this.left,this.start,0,Math.max(0,this.end-.01)],[this.right,this.end,Math.min(this.duration,this.start+.01),this.duration]]){
   el.setAttribute('aria-valuemin',min);el.setAttribute('aria-valuemax',max);el.setAttribute('aria-valuenow',value.toFixed(3));el.setAttribute('aria-valuetext',timelineTime(value));
  }
  this.seek.setAttribute('aria-valuemax',this.duration);this.paintCursor();
 }
 paintCursor(){
  const pct=this.duration?this.position/this.duration*100:0;this.head.style.left=pct+'%';this.head.classList.toggle('at-left',pct<8);this.head.classList.toggle('at-right',pct>92);
  this.head.querySelector('output').textContent=timelineTime(this.position);this.seek.setAttribute('aria-valuenow',this.position.toFixed(3));this.seek.setAttribute('aria-valuetext',timelineTime(this.position));
 }
 pointerTime(e){const rect=this.track.getBoundingClientRect();return clamp((e.clientX-rect.left)/rect.width,0,1)*this.duration}
 begin(e){
  if(this.disabled||!this.duration||e.button!==0)return;e.preventDefault();
  const edge=e.target.closest('.handle-start')?'start':e.target.closest('.handle-end')?'end':'seek';
  this.drag={edge,pointerId:e.pointerId};this.track.setPointerCapture(e.pointerId);this.root.classList.add('dragging');this.root.querySelector('.hover-time').hidden=true;
  (edge==='start'?this.left:edge==='end'?this.right:this.seek).focus({preventScroll:true});this.onInteraction?.();this.apply(edge,this.pointerTime(e));
 }
 move(e){
  if(this.disabled||!this.duration)return;
  if(this.drag){if(e.pointerId===this.drag.pointerId)this.apply(this.drag.edge,this.pointerTime(e));return}
  const hover=this.root.querySelector('.hover-time'),at=this.pointerTime(e);hover.hidden=false;hover.textContent=timelineTime(at);hover.style.left=clamp(at/this.duration*100,6,94)+'%';
 }
 finish(e){
  if(!this.drag||e.pointerId!==this.drag.pointerId)return;
  const id=this.drag.pointerId;this.drag=null;this.root.classList.remove('dragging');if(this.track.hasPointerCapture(id))this.track.releasePointerCapture(id);
 }
 apply(edge,value){
  if(edge==='seek'){this.position=clamp(value,0,this.duration);this.paintCursor();this.onSeek(this.position)}
  else{const at=trimBoundary(edge,value,this.start,this.end,this.duration);if(edge==='start')this.start=at;else this.end=at;this.position=at;this.paint();this.onTrim(edge,at);this.onSeek(at)}
 }
 key(e,edge){
  if(this.disabled||!this.duration)return;let at=edge==='start'?this.start:edge==='end'?this.end:this.position;
  const step=e.altKey ? .01 : e.shiftKey ? 1 : .1;
  if(e.key==='ArrowRight'||e.key==='ArrowUp')at+=step;else if(e.key==='ArrowLeft'||e.key==='ArrowDown')at-=step;else if(e.key==='Home')at=0;else if(e.key==='End')at=this.duration;else return;
  e.preventDefault();this.onInteraction?.();this.apply(edge,at);
 }
 destroy(){this.controller?.abort();this.observer.disconnect()}
}
