import {FORMATS,cropRect,outputSize,selection,buildCommand,encoding} from './engine.mjs';
import {MediaTimeline,parseTimeCode} from './timeline.mjs';
const $=id=>document.getElementById(id),media=$('media'),canvas=$('preview'),ctx=canvas.getContext('2d');
let file=null,meta=null,clips=[],sourceURL=null,resultURL=null,wave=null,busy=false,engine=null,enginePromise=null,cancelled=false;
let renderFrame=0,exportDuration=1,stageStart=0,stageSpan=100,audioContext=null;
const timeline=new MediaTimeline($('timeline-strip'),{onSeek:seekPreview,onTrim:(edge,at)=>{$(edge).value=time(at);update()},onInteraction:()=>media.pause()});
const MAX=500*1024*1024;
const number=id=>{
 const value=$(id).value;
 // Preserve the full source duration when its displayed timecode is rounded.
 if(id==='end'&&meta&&value===time(meta.duration))return meta.duration;
 return id==='start'||id==='end'?parseTimeCode(value):Number(value);
};
const time=n=>{const ticks=Math.round(Math.max(0,Number(n)||0)*100),secs=Math.floor(ticks/100);return `${Math.floor(secs/60).toString().padStart(2,'0')}:${(secs%60).toString().padStart(2,'0')}.${String(ticks%100).padStart(2,'0')}`};
function status(message,error=false){$('status').textContent=message;$('status').parentElement.classList.toggle('error',error);$('status').parentElement.hidden=false;$('close-status').hidden=busy||!document.body.classList.contains('has-file')}
function seekPreview(at){if(!meta)return;media.currentTime=Math.max(0,Math.min(at,meta.duration));timeline.setTime(at);syncPlayback();}
function syncPlayback(){timeline.setTime(media.currentTime);$('clock').textContent=`${time(media.currentTime)} / ${time(meta?.duration)}`;}
const toolTitles={cut:'Recortar',crop:'Encuadre',rotate:'Girar y reflejar',color:'Color',audio:'Audio',speed:'Velocidad',join:'Unir archivos'};
function openTool(tool){
 document.querySelectorAll('.tool-tab').forEach(el=>{const active=el.dataset.tool===tool;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active))});
 $('tool-panel').hidden=tool==='cut';$('tool-panel-title').textContent=toolTitles[tool];
 document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==tool);
}
function showExport(){if(!file||busy)return;openTool('cut');$('export-dialog').showModal()}
function options(){return {start:number('start'),end:number('end'),cut:document.querySelector('[name=cut]:checked').value,speed:number('speed'),rotation:number('rotation'),aspect:$('aspect').value,cropX:number('crop-x'),cropY:number('crop-y'),cropW:number('crop-w'),cropH:number('crop-h'),flipH:$('flip-h').checked,flipV:$('flip-v').checked,brightness:number('brightness'),contrast:number('contrast'),volume:number('volume'),mute:$('mute').checked,fadeIn:number('fade-in'),fadeOut:number('fade-out'),format:$('format').value,resolution:$('resolution').value,quality:$('quality').value}}
function setBusy(value){
 busy=value;document.querySelectorAll('aside fieldset,dialog fieldset').forEach(e=>e.disabled=value);
 for(const id of ['export','save','save-settings','reset','replace','add-clips','file','clips','start','end'])$(id).disabled=value;
 document.querySelectorAll('.tool-tab').forEach(e=>e.disabled=value);timeline.setDisabled(value);
 document.querySelectorAll('[name=cut],#clip-list button').forEach(e=>e.disabled=value);
 $('cancel').hidden=!value;$('cancel').disabled=false;$('progress').hidden=!value;$('close-status').hidden=value||!file;
 if(value){cancelled=false;media.pause();$('progress').value=0}else $('export').textContent='Exportar y descargar ↗';
}
function clearResult(){if(resultURL)URL.revokeObjectURL(resultURL);resultURL=null;$('download').hidden=true;$('download').removeAttribute('href')}
async function getEngine(){
 if(enginePromise)return enginePromise;
 if(!window.FFmpegWASM)throw Error('No se encontró el motor local. Comprueba que la carpeta editor/vendor esté completa.');
 engine=new FFmpegWASM.FFmpeg();
 engine.on('log',({message})=>{$('logs').textContent=($('logs').textContent+'\n'+message).slice(-10000)});
 engine.on('progress',({time:t})=>{$('progress').value=Math.min(99,stageStart+stageSpan*Math.max(0,t/1000000)/Math.max(.01,exportDuration))});
 status('Preparando el motor de edición por primera vez…');
 enginePromise=engine.load({coreURL:new URL('vendor/ffmpeg-core.js',location.href).href,wasmURL:new URL('vendor/ffmpeg-core.wasm',location.href).href}).then(()=>engine).catch(e=>{enginePromise=null;throw e});
 return enginePromise;
}
async function probe(ff,name){
 const probeName='metadata.json';
 try{await ff.deleteFile(probeName)}catch{}
 // ffprobe in core 0.12.10 can leave ret at -1 even after a successful probe.
 // Validate the generated JSON and streams rather than that sentinel value.
 await ff.ffprobe(['-v','error','-show_streams','-show_format','-of','json',name,'-o',probeName]);
 let info;
 try{info=JSON.parse(new TextDecoder().decode(await ff.readFile(probeName)))}catch{throw Error('El archivo no se pudo leer. Prueba otro formato o comprueba que no esté dañado.')}finally{try{await ff.deleteFile(probeName)}catch{}}
 const video=info.streams?.find(s=>s.codec_type==='video'&&s.disposition?.attached_pic!==1),audio=info.streams?.find(s=>s.codec_type==='audio');
 let width=video?.width||0,height=video?.height||0;
 const rotation=video?.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||Number(video?.tags?.rotate)||0;
 if(Math.abs(rotation)%180===90)[width,height]=[height,width];
 const duration=Number(info.format?.duration||video?.duration||audio?.duration);
 if(!Number.isFinite(duration)||duration<=0)throw Error('Este archivo no tiene una duración válida para editar.');
 if(!video&&!audio)throw Error('No se encontró ninguna pista de video o audio.');
 return {duration,width,height,hasVideo:!!video,hasAudio:!!audio};
}
function validateFile(f){if(f.size>MAX)throw Error('El límite de este editor es de 500 MB por archivo. Usa un archivo más pequeño.');if(!f.size)throw Error('El archivo está vacío.');}
function updateFormats(){
 const previous=$('format').value;$('format').replaceChildren();
 for(const [value,f]of Object.entries(FORMATS)){if(!meta.hasVideo&&f.video)continue;const opt=new Option(f.label,value);$('format').add(opt)}
 $('format').value=Object.hasOwn(FORMATS,previous)&&(meta.hasVideo||!FORMATS[previous].video)?previous:meta.hasVideo?'mp4':'mp3';
 formatUI();
}
function formatUI(){
 const format=$('format').value,isVideo=FORMATS[format]?.video;
 $('resolution-label').hidden=!isVideo;
 $('format-note').textContent=format==='gif'?'GIF no incluye audio. Exporta 12 fotogramas por segundo.':!isVideo&&meta?.hasVideo?'Se extraerá la pista de audio del video.':'La exportación aplica los ajustes seleccionados.';
}
function defaults(){
 const values={start:time(0),end:time(meta.duration),speed:1,rotation:0,aspect:'original','crop-x':0,'crop-y':0,'crop-w':100,'crop-h':100,brightness:100,contrast:100,volume:100,'fade-in':0,'fade-out':0,resolution:'original',quality:'medium'};
 for(const[id,value]of Object.entries(values))$(id).value=value;
 for(const id of ['flip-h','flip-v','mute'])$(id).checked=false;
 document.querySelector('[name=cut][value=keep]').checked=true;$('loop').checked=false;$('crop-fields').hidden=true;
 media.currentTime=0;timeline.setTime(0);openTool('cut');update();
}
async function openFile(f){
 if(!f||busy)return;
 try{validateFile(f)}catch(e){status(e.message,true);return}
 clearResult();media.pause();timeline.resetSource();if(sourceURL)URL.revokeObjectURL(sourceURL);file=f;wave=null;clips=[];renderClips();$('workspace').hidden=true;$('dropzone').hidden=false;document.body.classList.remove('has-file');
 sourceURL=URL.createObjectURL(f);status('Leyendo archivo…');setBusy(true);
 const browserMeta=await new Promise(resolve=>{
  const timer=setTimeout(()=>done(null),8000);
  function done(value){clearTimeout(timer);media.onloadedmetadata=null;media.onerror=null;resolve(value)}
  media.onloadedmetadata=()=>done(Number.isFinite(media.duration)&&media.duration>0?{duration:media.duration,width:media.videoWidth,height:media.videoHeight,hasVideo:media.videoWidth>0,hasAudio:true}:null);
  media.onerror=()=>done(null);media.src=sourceURL;media.load();
 });
 try{
  if(cancelled)return;
  meta=browserMeta;
  if(!meta){const ff=await getEngine();await ff.writeFile('inspect',new Uint8Array(await f.arrayBuffer()));try{meta=await probe(ff,'inspect')}finally{await ff.deleteFile('inspect')}}
  if(cancelled)return;
  $('workspace').hidden=false;$('dropzone').hidden=true;document.body.classList.add('has-file');$('filename').textContent=f.name;$('filename').title=f.name;
  $('file-kind').textContent=meta.hasVideo?'VIDEO':'AUDIO';$('fileinfo').textContent=`${time(meta.duration)} · ${(f.size/1048576).toFixed(1)} MB${meta.hasVideo?` · ${meta.width} × ${meta.height}`:''}`;
  document.querySelectorAll('.video-only').forEach(el=>el.hidden=!meta.hasVideo);
  timeline.setSource(sourceURL,{...meta,canPreview:!!browserMeta});
  $('preview-note').hidden=!!browserMeta;$('preview-note').textContent='Este formato no tiene vista previa en tu navegador. Puedes editar por tiempo y exportar a MP4 o MP3.';
  updateFormats();defaults();status('Archivo listo. Arrastra los bordes de la tira para recortar.');
  $('status').parentElement.hidden=true;
  if(!meta.hasVideo&&browserMeta)decodeWave(f);
  draw();
 }catch(e){if(!cancelled)status(e.message,true)}finally{setBusy(false)}
}
async function decodeWave(f){
 if(f.size>80*1024*1024)return;
 try{audioContext ||=new AudioContext();const buffer=await audioContext.decodeAudioData(await f.arrayBuffer());if(file!==f)return;const samples=buffer.getChannelData(0),bins=700;wave=Array.from({length:bins},(_,i)=>{let max=0;const a=Math.floor(i*samples.length/bins),b=Math.floor((i+1)*samples.length/bins);for(let j=a;j<b;j+=Math.max(1,Math.floor((b-a)/100)))max=Math.max(max,Math.abs(samples[j]));return max});timeline.setWave(wave);draw()}catch{/* Native playback still works without a waveform. */}
}
function update(){
 if(!meta)return;
 $('crop-fields').hidden=$('aspect').value!=='custom';
 for(const name of ['brightness','contrast','volume'])$(name+'-value').textContent=$(name).value+'%';
 media.playbackRate=number('speed');media.volume=Math.min(1,number('volume')/100);media.muted=$('mute').checked;
 syncPlayback();timeline.setSelection(number('start'),number('end'),document.querySelector('[name=cut]:checked').value==='remove');
 try{const {duration}=selection(meta,options());$('selection-label').textContent=`Resultado: ${time(duration)}`}catch{$('selection-label').textContent='Revisa el inicio y el fin'}
 draw();
}
function draw(){
 cancelAnimationFrame(renderFrame);ctx.fillStyle='#03050f';ctx.fillRect(0,0,960,540);
 if(!meta)return;
 syncPlayback();
 const o=options();
 if(meta.hasVideo&&media.readyState>=2){
  const c=cropRect(media.videoWidth||meta.width,media.videoHeight||meta.height,o),sw=o.rotation%180?c.h:c.w,sh=o.rotation%180?c.w:c.h,scale=Math.min(940/sw,520/sh);
  ctx.save();ctx.translate(480,270);ctx.scale(o.flipH?-1:1,o.flipV?-1:1);ctx.rotate(o.rotation*Math.PI/180);ctx.filter=`brightness(${o.brightness}%) contrast(${o.contrast}%)`;ctx.drawImage(media,c.x,c.y,c.w,c.h,-c.w*scale/2,-c.h*scale/2,c.w*scale,c.h*scale);ctx.restore();
 }else if(!meta.hasVideo){
  ctx.fillStyle='#9aa7ff';ctx.textAlign='center';ctx.font='18px system-ui';ctx.fillText('A U D I O   S T U D I O',480,140);
  if(wave){const played=media.currentTime/meta.duration;wave.forEach((n,i)=>{ctx.fillStyle=i/wave.length<played?'#b8c2ff':'#39446e';const h=Math.max(3,n*190);ctx.fillRect(60+i*840/wave.length,270-h/2,1.5,h)})}else{ctx.fillStyle='#a6adc9';ctx.font='16px system-ui';ctx.fillText('♫  '+file.name.slice(0,65),480,270)}
  ctx.fillStyle='#a6adc9';ctx.font='14px system-ui';ctx.fillText('Selecciona un intervalo en la línea de tiempo',480,395);
 }
 if(!media.paused)renderFrame=requestAnimationFrame(draw);
}
function renderClips(){
 $('clip-list').replaceChildren();clips.forEach((f,i)=>{const li=document.createElement('li'),text=document.createElement('span');text.textContent=f.name;li.append(text);if(i>0){const up=document.createElement('button');up.textContent='↑';up.setAttribute('aria-label','Mover antes '+f.name);up.onclick=()=>{[clips[i-1],clips[i]]=[clips[i],clips[i-1]];renderClips()};li.append(up)}const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label','Quitar '+f.name);remove.onclick=()=>{clips.splice(i,1);renderClips()};li.append(remove);$('clip-list').append(li)});
}
async function run(ff,args,duration,label,start,span){
 if(cancelled)throw Error('Cancelado');status(label);exportDuration=duration;stageStart=start;stageSpan=span;
 const code=await ff.exec(args);if(code!==0)throw Error('No se pudo exportar este archivo. Revisa los detalles o prueba MP4/MP3 y una resolución menor.');
}
async function exportFile(){
 if(!file||busy)return;const o=options();
 try{selection(meta,o);if(o.fadeIn<0||o.fadeOut<0||!Number.isFinite(o.fadeIn+o.fadeOut))throw Error('Los fundidos deben ser números positivos o cero.')}catch(e){status(e.message,true);return}
 $('export-dialog').close();openTool('cut');setBusy(true);clearResult();$('logs').textContent='';$('technical').hidden=true;const clean=[];
 try{
  const ff=await getEngine();if(cancelled)return;
  const input='source';clean.push(input);await ff.writeFile(input,new Uint8Array(await file.arrayBuffer()));const actual=await probe(ff,input);
  // Probe is authoritative: video containers may contain no audio at all.
  const opts={...o,end:Math.min(o.end,actual.duration)};const output='result.'+o.format;clean.push(output);
  if(!clips.length){const job=buildCommand(input,output,actual,opts);await run(ff,job.args,job.duration,'Aplicando tus ediciones…',0,100)}
  else{
   const video=FORMATS[o.format].video,files=[file,...clips],partNames=[],size=video?outputSize(actual,opts):null;let total=0;
   for(let i=0;i<files.length;i++){
    const name=i===0?input:'extra';if(i>0){clean.push(name);await ff.writeFile(name,new Uint8Array(await files[i].arrayBuffer()))}
    const m=i===0?actual:await probe(ff,name),part=`part${i}.${video?'mp4':'wav'}`;partNames.push(part);clean.push(part);
    const partOpts={...opts,format:video?'mp4':'wav',...(i?{start:0,end:m.duration,cut:'keep'}:{})};
    const job=buildCommand(name,part,m,partOpts,{normalize:true,normalizeSize:size});total+=job.duration;
    await run(ff,job.args,job.duration,`Preparando archivo ${i+1} de ${files.length}…`,i/files.length*80,80/files.length);
    if(i>0)await ff.deleteFile(name);
   }
   clean.push('sequence.txt');await ff.writeFile('sequence.txt',new TextEncoder().encode(partNames.map(n=>`file '${n}'`).join('\n')));
   const args=['-f','concat','-safe','0','-i','sequence.txt'];
   if(!video)args.push('-vn');else if(o.format==='gif')args.push('-filter_complex','[0:v]fps=12,split[a][b];[a]palettegen[p];[b][p]paletteuse');
   if(o.mute&&video)args.push('-an');args.push(...encoding(o.format,o.quality),'-y',output);
   await run(ff,args,total,'Uniendo archivos y preparando la descarga…',80,20);
  }
  const data=await ff.readFile(output);if(cancelled)return;
  resultURL=URL.createObjectURL(new Blob([data],{type:FORMATS[o.format].mime}));const download=$('download');download.href=resultURL;download.download=file.name.replace(/\.[^.]+$/,'')+'-editado.'+o.format;download.hidden=false;
  $('progress').value=100;status(`¡Listo! Tu archivo editado pesa ${(data.length/1048576).toFixed(2)} MB. Descárgalo con el botón.`);
 }catch(e){if(!cancelled){status(e.message||'La exportación falló. Prueba un archivo más pequeño.',true);$('technical').hidden=false}}
 finally{if(engine&&!cancelled){for(const name of [...new Set(clean)])try{await engine.deleteFile(name)}catch{}}engine?.terminate();engine=null;enginePromise=null;setBusy(false)}
}
$('file').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';openFile(f)});
$('replace').onclick=()=>$('file').click();$('add-clips').onclick=()=>$('clips').click();
$('clips').onchange=e=>{try{const extra=[...e.target.files];extra.forEach(validateFile);if(clips.length+extra.length>9)throw Error('Puedes unir hasta 10 archivos en una exportación.');if([file,...clips,...extra].reduce((n,f)=>n+f.size,0)>MAX)throw Error('Los archivos de una unión pueden sumar hasta 500 MB.');clips.push(...extra);renderClips();status('Archivos añadidos. Al exportar se unirán en este orden.')}catch(err){status(err.message,true)}e.target.value=''};
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag')});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('drag');if(event==='drop')openFile(e.dataTransfer.files[0])});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('reset').onclick=()=>{defaults();status('Ajustes restablecidos.');clearResult()};
$('format').onchange=formatUI;
document.querySelectorAll('aside input,aside select,#start,#end,[name=cut]').forEach(el=>el.addEventListener('input',update));
for(const id of ['start','end'])$(id).addEventListener('change',()=>{const at=number(id);if(Number.isFinite(at)){$(id).value=time(at);update();media.pause();seekPreview(at)}});
$('to-start').onclick=()=>{media.pause();seekPreview(number('start')||0)};
document.querySelectorAll('.tool-tab').forEach(el=>el.onclick=()=>openTool(el.dataset.tool));
$('close-tool').onclick=$('apply-tool').onclick=()=>openTool('cut');
$('rotate-left').onclick=()=>{$('rotation').value=String((number('rotation')+270)%360);update()};
$('rotate-right').onclick=()=>{$('rotation').value=String((number('rotation')+90)%360);update()};
$('save').onclick=$('save-settings').onclick=showExport;$('close-export').onclick=()=>$('export-dialog').close();
$('close-status').onclick=()=>{$('status').parentElement.hidden=true};
$('export-dialog').addEventListener('click',e=>{if(e.target===$('export-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
$('play').onclick=async()=>{
 if(!file)return;if(!media.paused){media.pause();return}
 const o=options();if(media.currentTime>=meta.duration-.01)media.currentTime=$('loop').checked&&o.cut==='keep'?o.start:0;
 if($('loop').checked&&o.cut==='keep'&&(media.currentTime<o.start||media.currentTime>=o.end))media.currentTime=o.start;
 try{await media.play()}catch{status('Este navegador no puede reproducir el archivo original. Puedes exportarlo a un formato compatible.',true)}
};
media.addEventListener('play',()=>{$('play').textContent='Ⅱ';draw()});media.addEventListener('pause',()=>{$('play').textContent='▶';syncPlayback()});
media.addEventListener('loadeddata',draw);media.addEventListener('seeked',draw);
media.addEventListener('timeupdate',()=>{
 syncPlayback();
 if(media.paused||!meta||!$('loop').checked)return;const o=options();
 if(o.cut==='keep'&&o.end>o.start&&media.currentTime>=o.end)media.currentTime=o.start;
 if(o.cut==='remove'&&media.currentTime>=o.start&&media.currentTime<o.end)media.currentTime=o.end;
});
media.addEventListener('ended',()=>{if($('loop').checked&&meta){media.currentTime=options().cut==='keep'?number('start'):0;media.play().catch(()=>{})}});
$('export').onclick=exportFile;
$('cancel').onclick=()=>{cancelled=true;engine?.terminate();engine=null;enginePromise=null;$('cancel').disabled=true;status('Procesamiento cancelado. Puedes cambiar los ajustes y volver a exportar.');};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('tool-panel').hidden)openTool('cut');if(e.code==='Space'&&file&&!busy&&!$('export-dialog').open&&!['INPUT','SELECT','BUTTON','TEXTAREA','A'].includes(e.target.tagName)){e.preventDefault();$('play').click()}});
window.addEventListener('beforeunload',()=>{timeline.destroy();if(sourceURL)URL.revokeObjectURL(sourceURL);if(resultURL)URL.revokeObjectURL(resultURL);engine?.terminate();audioContext?.close()});
if(location.protocol==='file:')status('Abre el sitio desde un servidor web (HTTP/HTTPS). El motor no puede ejecutarse abriendo el HTML con doble clic.',true);
