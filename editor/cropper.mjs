const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function moveCrop(rect,dx,dy){return {...rect,x:clamp(rect.x+dx,0,1-rect.w),y:clamp(rect.y+dy,0,1-rect.h)}}
// Work in normalized source coordinates, independent of the displayed video size.
export function resizeCrop(rect,edge,dx,dy,ratio=null){
 const min=.01;
 if(ratio){
  const horizontal=edge.includes('e')||edge.includes('w'),vertical=edge.includes('n')||edge.includes('s');
  const fixedX=edge.includes('w')?rect.x+rect.w:edge.includes('e')?rect.x:rect.x+rect.w/2;
  const fixedY=edge.includes('n')?rect.y+rect.h:edge.includes('s')?rect.y:rect.y+rect.h/2;
  let w=horizontal?rect.w+(edge.includes('w')?-dx:dx):((rect.h+(edge.includes('n')?-dy:dy))*ratio);
  if(horizontal&&vertical&&Math.abs(dy*ratio)>Math.abs(dx))w=(rect.h+(edge.includes('n')?-dy:dy))*ratio;
  const maxW=(horizontal?(edge.includes('w')?fixedX:1-fixedX):2*Math.min(fixedX,1-fixedX));
  const maxH=(vertical?(edge.includes('n')?fixedY:1-fixedY):2*Math.min(fixedY,1-fixedY));
  w=clamp(w,Math.min(Math.max(min,min*ratio),maxW,maxH*ratio),Math.min(maxW,maxH*ratio));const h=w/ratio;
  return {x:horizontal?(edge.includes('w')?fixedX-w:fixedX):fixedX-w/2,y:vertical?(edge.includes('n')?fixedY-h:fixedY):fixedY-h/2,w,h};
 }
 let left=rect.x,top=rect.y,right=left+rect.w,bottom=top+rect.h;
 if(edge.includes('w'))left=clamp(left+dx,0,right-min);if(edge.includes('e'))right=clamp(right+dx,left+min,1);
 if(edge.includes('n'))top=clamp(top+dy,0,bottom-min);if(edge.includes('s'))bottom=clamp(bottom+dy,top+min,1);
 return {x:left,y:top,w:right-left,h:bottom-top};
}
export function newCrop(from,to,ratio=null){
 const dx=to.x-from.x,dy=to.y-from.y;let w=Math.max(.01,Math.abs(dx)),h=Math.max(.01,Math.abs(dy));
 if(ratio){w=Math.max(w,h*ratio);h=w/ratio;const scale=Math.min(1,(dx<0?from.x:1-from.x)/w,(dy<0?from.y:1-from.y)/h);w*=scale;h*=scale}
 const x=clamp(dx<0?from.x-w:from.x,0,1-w),y=clamp(dy<0?from.y-h:from.y,0,1-h);
 return {x,y,w,h};
}
export class VideoCropper{
 constructor(root,{onChange,onInteraction}){
  this.root=root;this.onChange=onChange;this.onInteraction=onInteraction;this.rect={x:0,y:0,w:1,h:1};this.ratio=null;this.drag=null;
  root.innerHTML='<div class="crop-shade shade-top"></div><div class="crop-shade shade-bottom"></div><div class="crop-shade shade-left"></div><div class="crop-shade shade-right"></div><div class="crop-box" tabindex="0" role="group" aria-label="Marco de recorte. Usa las flechas para moverlo." title="Arrastra el marco para mover el recorte"><span class="crop-grid"></span></div>';
  this.box=root.querySelector('.crop-box');
  const names={nw:'superior izquierda',n:'superior',ne:'superior derecha',e:'derecha',se:'inferior derecha',s:'inferior',sw:'inferior izquierda',w:'izquierda'};
  for(const [edge,name]of Object.entries(names)){
   const handle=document.createElement('button');handle.type='button';handle.className='crop-handle crop-'+edge;handle.dataset.edge=edge;handle.setAttribute('aria-label','Redimensionar borde '+name);handle.title='Arrastra para redimensionar';this.box.append(handle);
   handle.addEventListener('keydown',e=>this.keyboard(e,edge));
  }
  this.box.addEventListener('keydown',e=>{if(e.target===this.box)this.keyboard(e,'move')});
  root.addEventListener('pointerdown',e=>this.begin(e));root.addEventListener('pointermove',e=>this.move(e));
  for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,e=>this.finish(e));
 }
 setRect(rect,ratio){this.ratio=ratio;if(this.drag)return;this.rect=rect;this.paint()}
 setVisible(visible){this.root.hidden=!visible;if(!visible&&this.drag)this.finish({pointerId:this.drag.id})}
 setViewport({left,top,width,height}){Object.assign(this.root.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'})}
 paint(){
  const {x,y,w,h}=this.rect;
  Object.assign(this.box.style,{left:x*100+'%',top:y*100+'%',width:w*100+'%',height:h*100+'%'});
  const shades=[['.shade-top',0,0,1,y],['.shade-bottom',0,y+h,1,1-y-h],['.shade-left',0,y,x,h],['.shade-right',x+w,y,1-x-w,h]];
  for(const [selector,l,t,width,height]of shades)Object.assign(this.root.querySelector(selector).style,{left:l*100+'%',top:t*100+'%',width:Math.max(0,width)*100+'%',height:Math.max(0,height)*100+'%'});
  this.box.setAttribute('aria-description',`Posición ${Math.round(x*100)}%, ${Math.round(y*100)}%. Ancho ${Math.round(w*100)}%, alto ${Math.round(h*100)}%.`);
 }
 point(e){const r=this.root.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)}}
 begin(e){
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();this.onInteraction?.();const p=this.point(e);
  const handle=e.target.closest('[data-edge]'),full=this.rect.w>.999&&this.rect.h>.999;
  const edge=handle?.dataset.edge||(!full&&!e.shiftKey&&e.target.closest('.crop-box')?'move':'new');
  this.drag={id:e.pointerId,edge,from:p,original:{...this.rect},moved:false};this.root.setPointerCapture(e.pointerId);(handle||this.box).focus({preventScroll:true});
 }
 move(e){
  const d=this.drag;if(!d||e.pointerId!==d.id)return;const p=this.point(e),dx=p.x-d.from.x,dy=p.y-d.from.y;
  if(!d.moved&&Math.abs(dx)+Math.abs(dy)<.003)return;d.moved=true;
  const rect=d.edge==='move'?moveCrop(d.original,dx,dy):d.edge==='new'?newCrop(d.from,p,this.ratio):resizeCrop(d.original,d.edge,dx,dy,this.ratio);
  if(rect.w<.01||rect.h<.01)return;this.rect=rect;
  this.paint();this.onChange({...this.rect});
 }
 finish(e){if(!this.drag||e.pointerId!==this.drag.id)return;const {id,moved}=this.drag;this.drag=null;if(this.root.hasPointerCapture(id))this.root.releasePointerCapture(id);if(moved)this.onChange({...this.rect})}
 keyboard(e,edge){
  const delta=e.shiftKey ? .05 : .005;let dx=0,dy=0;
  if(e.key==='ArrowLeft')dx=-delta;else if(e.key==='ArrowRight')dx=delta;else if(e.key==='ArrowUp')dy=-delta;else if(e.key==='ArrowDown')dy=delta;else return;
  e.preventDefault();e.stopPropagation();this.onInteraction?.();this.rect=edge==='move'?moveCrop(this.rect,dx,dy):resizeCrop(this.rect,edge,dx,dy,this.ratio);this.paint();this.onChange({...this.rect});
 }
}
