export const FORMATS = {
 mp4: {mime:'video/mp4', video:true, label:'MP4 · Video'},
 webm: {mime:'video/webm', video:true, label:'WebM · Video'},
 gif: {mime:'image/gif', video:true, label:'GIF · Sin audio'},
 mp3: {mime:'audio/mpeg', video:false, label:'MP3 · Audio'},
 wav: {mime:'audio/wav', video:false, label:'WAV · Audio'},
 m4a: {mime:'audio/mp4', video:false, label:'M4A · Audio'},
 ogg: {mime:'audio/ogg', video:false, label:'OGG · Audio'}
};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const even=n=>Math.max(2,Math.floor(n/2)*2);
export function cropRect(width,height,o){
 let x=0,y=0,w=width,h=height;
 if(o.aspect==='custom'){
  x=clamp(o.cropX,0,99)*width/100;y=clamp(o.cropY,0,99)*height/100;
  w=clamp(o.cropW,1,100)*width/100;h=clamp(o.cropH,1,100)*height/100;
  w=Math.min(w,width-x);h=Math.min(h,height-y);
 }else if(o.aspect!=='original'){
  const ratio=Number(o.aspect);if(width/height>ratio)w=height*ratio;else h=width/ratio;
  x=(width-w)/2;y=(height-h)/2;
 }
 return {x:Math.max(0,Math.floor(x/2)*2),y:Math.max(0,Math.floor(y/2)*2),w:even(w),h:even(h)};
}
export function selection(meta,o){
 const start=Number(o.start),end=Number(o.end);
 if(!Number.isFinite(meta.duration)||meta.duration<=0)throw Error('No se pudo determinar la duración de este archivo.');
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>meta.duration+0.02||end<=start)throw Error('El inicio debe ser menor que el fin y ambos deben estar dentro del archivo.');
 let segments=o.cut==='remove'?[[0,start],[end,meta.duration]].filter(([a,b])=>b-a>0.005):[[start,Math.min(end,meta.duration)]];
 if(!segments.length)throw Error('No puedes eliminar el archivo completo. Conserva una parte para exportar.');
 return {segments,duration:segments.reduce((n,[a,b])=>n+b-a,0)/o.speed};
}
export function outputSize(meta,o){
 const crop=cropRect(meta.width,meta.height,o);let w=crop.w,h=crop.h;
 if(o.rotation===90||o.rotation===270)[w,h]=[h,w];
 if(o.resolution!=='original'){
  const short=Number(o.resolution),long=short*16/9;
  const scale=Math.min(1,w>=h?long/w:short/w,w>=h?short/h:long/h);w*=scale;h*=scale;
 }
 return {w:even(w),h:even(h)};
}
export function tempoFilters(speed){
 let n=speed;const f=[];while(n>2){f.push('atempo=2');n/=2}while(n<0.5){f.push('atempo=0.5');n/=0.5}f.push(`atempo=${n}`);return f;
}
export function encoding(format,quality='medium'){
 const crf={high:18,medium:23,low:30}[quality],rate={high:'256k',medium:'192k',low:'128k'}[quality];
 switch(format){
  case'mp4':return ['-c:v','libx264','-preset','ultrafast','-crf',String(crf),'-pix_fmt','yuv420p','-c:a','aac','-b:a',rate,'-movflags','+faststart'];
  case'webm':return ['-c:v','libvpx','-threads','1','-deadline','realtime','-cpu-used','4','-pix_fmt','yuv420p','-crf',String(crf+8),'-b:v','1000k','-c:a','libvorbis','-b:a',rate];
  case'gif':return ['-an','-loop','0'];
  case'mp3':return ['-c:a','libmp3lame','-b:a',rate];
  case'wav':return ['-c:a','pcm_s16le'];
  case'm4a':return ['-c:a','aac','-b:a',rate,'-movflags','+faststart'];
  case'ogg':return ['-c:a','libvorbis','-q:a',quality==='high'?'7':quality==='low'?'3':'5'];
  default:throw Error('Formato no válido.');
 }
}
export function buildCommand(input,output,meta,o,{normalizeSize=null,normalize=false}={}){
 if(!FORMATS[o.format])throw Error('Formato no válido.');
 const video=FORMATS[o.format].video;
 if(video&&!meta.hasVideo)throw Error('Un archivo de audio no se puede exportar como video.');
 if(!video&&!meta.hasAudio)throw Error('El archivo no contiene una pista de audio.');
 if(!video&&o.mute)throw Error('Desactiva «Silenciar audio» para exportar un archivo de audio.');
 const {segments,duration}=selection(meta,o),audio=o.format!=='gif'&&(!o.mute||normalize)&&(meta.hasAudio||normalize);
 const args=['-i',input],f=[],v=[],a=[];
 if(audio&&!meta.hasAudio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
 segments.forEach(([start,end],i)=>{
  if(video){f.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`);v.push(`[v${i}]`)}
  if(audio){f.push(`[${meta.hasAudio?'0':'1'}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);a.push(`[a${i}]`)}
 });
 let vi=v[0],ai=a[0];
 if(segments.length>1){if(video){f.push(`${v.join('')}concat=n=${v.length}:v=1:a=0[vc]`);vi='[vc]'}if(audio){f.push(`${a.join('')}concat=n=${a.length}:v=0:a=1[ac]`);ai='[ac]'}}
 if(video){
  const c=cropRect(meta.width,meta.height,o),vf=[`crop=${c.w}:${c.h}:${c.x}:${c.y}`];
  if(o.rotation===90)vf.push('transpose=1');if(o.rotation===180)vf.push('hflip','vflip');if(o.rotation===270)vf.push('transpose=2');
  if(o.flipH)vf.push('hflip');if(o.flipV)vf.push('vflip');
  vf.push(`colorchannelmixer=rr=${o.brightness/100}:gg=${o.brightness/100}:bb=${o.brightness/100}`,`eq=contrast=${o.contrast/100}`,`setpts=(PTS-STARTPTS)/${o.speed}`);
  const size=normalizeSize||outputSize(meta,o);
  vf.push(`scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:force_divisible_by=2`,`pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:color=black`,'setsar=1');
  if(normalize)vf.push('fps=30');if(o.format==='gif')vf.push('fps=12','split[g1][g2];[g1]palettegen[p];[g2][p]paletteuse');
  f.push(`${vi}${vf.join(',')}[video]`);
 }
 if(audio){
  const af=[...tempoFilters(o.speed),`volume=${o.mute?0:o.volume/100}`];
  const fadeIn=Math.min(o.fadeIn,duration),fadeOut=Math.min(o.fadeOut,duration);
  if(fadeIn>0)af.push(`afade=t=in:d=${fadeIn}`);if(fadeOut>0)af.push(`afade=t=out:st=${Math.max(0,duration-fadeOut)}:d=${fadeOut}`);
  af.push('aresample=48000','aformat=channel_layouts=stereo');f.push(`${ai}${af.join(',')}[audio]`);
 }
 args.push('-filter_complex',f.join(';'));
 if(video)args.push('-map','[video]');else args.push('-vn');
 if(audio)args.push('-map','[audio]');else args.push('-an');
 args.push(...encoding(o.format,o.quality),'-t',duration.toFixed(6),'-y',output);
 return {args,duration};
}
