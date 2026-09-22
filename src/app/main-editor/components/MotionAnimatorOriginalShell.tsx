'use client';

/**
 * CutLab Motion Animator — transplanted Motion Suite workspace shell.
 *
 * UI source of truth: cutlabmotion_3593/src/app/components/MotionAnimatorContent.tsx
 * (main @ b40e83d0726cb202c4a2f9aa186e86f85e0c839a)
 *
 * This file intentionally preserves that workspace's panel geometry and visual
 * language while replacing MOCK_DOCUMENT/private history with the CutLab Studio
 * host bridge. It is a UI transplant, not a second Motion engine.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BarChart2, ChevronDown, ChevronRight, Eye, EyeOff, GitBranch, Layers, Lock, Maximize2, Move, PanelBottom, PanelRight, Pause, Play, Settings2, SkipBack, SkipForward, Unlock, Volume2, X } from 'lucide-react';
import { useEngine } from '@/engine/store';
import { createMotionAnimatorHostBridge } from '@/engine/motion-animator-host-bridge';
import type { WorkspaceHandoff } from '@/engine/workspace-context';
import { buildReturnHandoff } from '@/engine/workspace-context';
import type {
  MotionDocument, MotionObject, MotionKeyframe, MotionBehavior
} from '@/engine/motion-document';
import { type FrameState, motionTimeToSeconds } from '@/engine/motion-document-utils';
import { evaluateMotionDocument } from '@/engine/motion-document-utils';
import { makeOp as makeMotionOp } from '@/engine/motion-document-utils';
import TextMotionPanel from './TextMotionPanel';
import CreativeMacrosPanel from './CreativeMacrosPanel';
import SignalBindingPanel from './SignalBindingPanel';
import SpatialDepthPanel from './SpatialDepthPanel';
import SceneScriptPanel from './SceneScriptPanel';
import SignalResourcePanel from './SignalResourcePanel';
import EvaluationTracePanel from './EvaluationTracePanel';
import MotionLibrary from './MotionLibrary';
import AICreativeOperatorPanel from './AICreativeOperatorPanel';
import LibraryPackagePanel from './LibraryPackagePanel';
import SVGPossibilityPanel from './SVGPossibilityPanel';

type ProPanel = 'none' | 'curve' | 'dopesheet' | 'protools';
type Drawer = 'none' | 'text' | 'spatial' | 'signals' | 'resources' | 'macros' | 'library' | 'scene' | 'trace' | 'ai' | 'packages' | 'svg';

interface Props {
  handoff: WorkspaceHandoff;
  onReturnToStudio: (returnHandoff: ReturnType<typeof buildReturnHandoff>) => void;
}

interface UiTrack {
  id: string;
  name: string;
  type: string;
  color: string;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  startFrame: number;
  endFrame: number;
  object: MotionObject;
}

const KIND_COLOR: Record<string, string> = {
  text: '#a78bfa', shape: '#38bdf8', image: '#34d399', video: '#22c55e',
  group: '#fbbf24', camera: '#67e8f9', light: '#fb923c', particle: '#f472b6',
  path: '#c084fc', mask: '#ef4444', svg: '#60a5fa', null: '#94a3b8',
};

function frameFromTime(t: { value: number; timescale: number }, fps: number) {
  return Math.round((t.value / t.timescale) * fps);
}

function docToTracks(doc: MotionDocument): UiTrack[] {
  const totalFrames = Math.max(1, Math.round(motionTimeToSeconds(doc.duration) * doc.fps));
  const ids = [...doc.rootObjectIds, ...Object.keys(doc.objects).filter(id => !doc.rootObjectIds.includes(id))];
  return ids.map((id) => {
    const object = doc.objects[id];
    return {
      id,
      name: object?.name ?? id,
      type: object?.kind ?? 'object',
      color: KIND_COLOR[object?.kind ?? ''] ?? '#94a3b8',
      muted: false,
      locked: object?.locked ?? false,
      visible: object?.visible ?? true,
      startFrame: 0,
      endFrame: totalFrames,
      object,
    };
  }).filter(t => !!t.object);
}

function getTransform(state: any) {
  return state?.worldTransform ?? state?.transform ?? null;
}

function CanonicalCanvas({
  doc, frameState, currentFrame, totalFrames, selectedId, onSelect
}: {
  doc: MotionDocument;
  frameState: FrameState | null;
  currentFrame: number;
  totalFrames: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const states = frameState?.objects ?? [];
  return (
    <div className="relative w-full h-full bg-[#0a0a0f] overflow-hidden flex items-center justify-center">
      <div
        className="relative overflow-hidden border border-border/70 bg-[#111118] shadow-2xl"
        style={{ aspectRatio: doc.width + ' / ' + doc.height, height: '88%', maxWidth: '94%' }}
      >
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: 'linear-gradient(45deg,#fff 25%,transparent 25%),linear-gradient(-45deg,#fff 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#fff 75%),linear-gradient(-45deg,transparent 75%,#fff 75%)',
          backgroundSize: '24px 24px', backgroundPosition: '0 0,0 12px,12px -12px,-12px 0'
        }} />
        {states.filter((s: any) => s.visible !== false).map((s: any) => {
          const tr = getTransform(s);
          const obj = doc.objects[s.objectId];
          if (!obj || !tr) return null;
          const x = 50 + (tr.x ?? 0) / Math.max(doc.width, 1) * 100;
          const y = 50 + (tr.y ?? 0) / Math.max(doc.height, 1) * 100;
          const sx = tr.scaleX ?? 1;
          const sy = tr.scaleY ?? 1;
          const rz = tr.rotationZ ?? 0;
          const opacity = s.opacity ?? tr.opacity ?? 1;
          const depth = s.depth ?? obj.depth ?? 0;
          const text = s.textContent ?? obj.textSegments?.map(seg => seg.text).join(' ') ?? obj.name;
          const isText = obj.kind === 'text';
          return (
            <button
              key={s.objectId}
              onClick={() => onSelect(s.objectId)}
              className="absolute border-0 bg-transparent p-0"
              style={{
                left: x + '%', top: y + '%',
                transform: 'translate(-50%,-50%) translateZ(' + depth + 'px) rotate(' + rz + 'deg) scale(' + sx + ',' + sy + ')',
                opacity,
                color: 'white',
                outline: selectedId === s.objectId ? '1px solid #a78bfa' : 'none',
                outlineOffset: 4,
                zIndex: Math.round(1000 + depth),
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              {isText ? (
                <span style={{ fontSize: obj.textSegments?.[0]?.fontSize ?? 42, fontWeight: obj.textSegments?.[0]?.fontWeight ?? 700, whiteSpace: 'nowrap' }}>
                  {text}
                </span>
              ) : (
                <span className="block min-w-16 min-h-10 px-4 py-3 rounded border border-white/15 bg-white/5 text-[10px] text-white/60">
                  {obj.name}
                </span>
              )}
            </button>
          );
        })}
        <div className="absolute left-0 right-0 bottom-0 h-[3px] bg-zinc-800/70">
          <div className="h-full bg-violet-400/80" style={{ width: ((currentFrame / Math.max(totalFrames,1))*100) + '%' }} />
        </div>
      </div>
    </div>
  );
}

function Transport({
  playing, currentFrame, totalFrames, fps, onPlay, onStop, onSeek
}: {
  playing: boolean; currentFrame: number; totalFrames: number; fps: number;
  onPlay: () => void; onStop: () => void; onSeek: (f:number)=>void;
}) {
  const progress = currentFrame / Math.max(totalFrames, 1);
  const tc = (f:number) => {
    const s = f / fps;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const fr = Math.floor(f % fps);
    return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') + ':' + String(fr).padStart(2,'0');
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-card/60">
      <div className="flex items-center gap-1">
        <button onClick={() => onSeek(0)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"><SkipBack size={14}/></button>
        <button onClick={onStop} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"><X size={14}/></button>
        <button onClick={onPlay} className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80">
          {playing ? <Pause size={14}/> : <Play size={14}/>}
        </button>
        <button onClick={() => onSeek(Math.max(0,totalFrames-1))} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"><SkipForward size={14}/></button>
      </div>
      <div className="font-mono text-xs"><span className="text-accent">{tc(currentFrame)}</span><span className="text-muted-foreground"> / {tc(totalFrames)}</span></div>
      <div className="flex-1 relative h-5 flex items-center">
        <div className="w-full h-1 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary" style={{width:(progress*100)+'%'}}/></div>
        <input aria-label="Motion Animator scrubber" className="absolute inset-0 w-full opacity-0 cursor-pointer" type="range" min={0} max={Math.max(0,totalFrames-1)} value={currentFrame} onChange={e=>onSeek(Number(e.target.value))}/>
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-accent border-2 border-background pointer-events-none" style={{left:'calc('+(progress*100)+'% - 6px)'}}/>
      </div>
      <Volume2 size={14} className="text-muted-foreground"/>
      <span className="font-mono text-2xs text-foreground bg-secondary px-1.5 py-0.5 rounded">{fps} fps</span>
    </div>
  );
}

function AnimatorTimeline({
  tracks, selectedId, onSelect, currentFrame, totalFrames, fps
}: {
  tracks: UiTrack[]; selectedId: string | null; onSelect: (id:string)=>void;
  currentFrame:number; totalFrames:number; fps:number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const progress = currentFrame / Math.max(totalFrames, 1);
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <div className="flex flex-shrink-0 border-b border-border h-6">
        <div className="w-[220px] flex-shrink-0 border-r border-border bg-card"/>
        <div className="flex-1 relative bg-card/40">
          {Array.from({length:13},(_,i)=>i).map(i=><div key={i} className="absolute top-0 bottom-0 text-[9px] text-muted-foreground" style={{left:(i/12*100)+'%'}}><div className="w-px h-2 bg-border mt-1"/>{Math.round(i/12*totalFrames)}</div>)}
          <div className="absolute top-0 bottom-0 w-px bg-accent z-20" style={{left:(progress*100)+'%'}}/>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {tracks.map(track=>{
          const ex=expanded.has(track.id);
          const kfs=track.object.keyframes ?? [];
          const behaviors=track.object.behaviors ?? [];
          return <div key={track.id}>
            <div onClick={()=>onSelect(track.id)} className={'flex items-stretch border-b border-border cursor-pointer '+(selectedId===track.id?'bg-primary/5':'')} style={{height:36}}>
              <div className="w-[220px] flex-shrink-0 flex items-center gap-1.5 px-2 border-r border-border">
                <div className="w-2 h-2 rounded-full" style={{background:track.color}}/>
                <button onClick={e=>{e.stopPropagation();setExpanded(p=>{const n=new Set(p);n.has(track.id)?n.delete(track.id):n.add(track.id);return n;});}} className="text-muted-foreground">{ex?<ChevronDown size={10}/>:<ChevronRight size={10}/>}</button>
                <span className={'text-xs truncate flex-1 '+(selectedId===track.id?'text-foreground':'text-muted-foreground')}>{track.name}</span>
                <span className="text-[9px] font-mono text-muted-foreground/60">{track.type}</span>
                {track.locked?<Lock size={11} className="text-warning"/>:<Unlock size={11} className="text-muted-foreground"/>}
                {track.visible?<Eye size={11} className="text-muted-foreground"/>:<EyeOff size={11} className="text-muted-foreground/30"/>}
              </div>
              <div className="flex-1 relative overflow-hidden">
                {behaviors.map((b:MotionBehavior)=><div key={b.id} className="absolute top-1 bottom-1 rounded border bg-primary/20 border-primary/40 text-[9px] text-foreground/70 px-1 truncate" style={{
                  left:(frameFromTime(b.startTime, fps)/Math.max(totalFrames,1)*100)+'%',
                  width:Math.max(2, frameFromTime(b.duration, fps)/Math.max(totalFrames,1)*100)+'%'
                }}>{b.type}</div>)}
                {kfs.map((kf:MotionKeyframe)=>{
                  const f=frameFromTime(kf.time, fps);
                  return <div key={kf.id} title={kf.property} className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-accent border border-background" style={{left:'calc('+(f/Math.max(totalFrames,1)*100)+'% - 4px)'}}/>;
                })}
                <div className="absolute top-0 bottom-0 w-px bg-accent/70 z-20" style={{left:(progress*100)+'%'}}/>
              </div>
            </div>
            {ex && <div className="bg-background/50 border-b border-border px-[230px] py-1 text-[10px] text-muted-foreground">
              {kfs.length} keyframes · {behaviors.length} behaviors · {track.object.masks?.length ?? 0} masks
            </div>}
          </div>;
        })}
      </div>
    </div>
  );
}

function Inspector({
  doc, object, commit
}: {
  doc: MotionDocument; object: MotionObject | null;
  commit: (ops: ReturnType<typeof makeMotionOp>[], description:string)=>void;
}) {
  if(!object) return <div className="p-4 text-xs text-muted-foreground">Select an object</div>;
  const t=object.transform;
  const setTransform=(patch:any,label:string)=>commit([makeMotionOp('motion.setObjectTransform',doc.id,{objectId:object.id,transform:patch})],label);
  const num=(label:string,val:number,onChange:(v:number)=>void)=><label className="grid grid-cols-[72px_1fr] items-center gap-2 text-[10px]"><span className="text-muted-foreground">{label}</span><input className="bg-secondary border border-border rounded px-2 py-1 text-foreground font-mono" type="number" step="0.1" value={Number.isFinite(val)?val:0} onChange={e=>onChange(Number(e.target.value))}/></label>;
  return <div className="h-full overflow-y-auto scrollbar-thin bg-background/80">
    <div className="px-4 py-3 border-b border-border">
      <div className="text-xs font-semibold text-foreground">{object.name}</div>
      <div className="text-[10px] text-muted-foreground font-mono">{object.kind} · {object.id}</div>
    </div>
    <div className="p-3 space-y-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Transform</div>
      {num('Position X',t.x,v=>setTransform({x:v},'Set Position X'))}
      {num('Position Y',t.y,v=>setTransform({y:v},'Set Position Y'))}
      {num('Depth Z',t.z,v=>setTransform({z:v},'Set Depth Z'))}
      {num('Rotation Z',t.rotationZ,v=>setTransform({rotationZ:v},'Set Rotation Z'))}
      {num('Scale X',t.scaleX,v=>setTransform({scaleX:v},'Set Scale X'))}
      {num('Scale Y',t.scaleY,v=>setTransform({scaleY:v},'Set Scale Y'))}
      {num('Opacity',t.opacity,v=>setTransform({opacity:Math.max(0,Math.min(1,v))},'Set Opacity'))}
    </div>
    <div className="p-3 border-t border-border space-y-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Authoring</div>
      <div className="text-[10px] text-muted-foreground">{object.keyframes.length} keyframes</div>
      <div className="text-[10px] text-muted-foreground">{object.behaviors.length} behaviors</div>
      <div className="text-[10px] text-muted-foreground">{object.masks.length} masks</div>
      <div className="text-[10px] text-muted-foreground">{(object.materialId ? doc.materials[object.materialId]?.type : undefined) ?? 'no material'}</div>
    </div>
  </div>;
}

function KeyframePanel({
  object, fps, totalFrames, currentFrame, kind
}: {object:MotionObject|null;fps:number;totalFrames:number;currentFrame:number;kind:'curve'|'dope'}) {
  const kfs=object?.keyframes ?? [];
  return <div className="h-full bg-[#0a0a0f] border-t border-border overflow-hidden">
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/30">
      <span className="text-xs font-semibold text-foreground">{kind==='curve'?'Graph / Curve Editor':'Dope Sheet'}</span>
      <span className="text-[10px] text-muted-foreground">{object?.name ?? 'No selection'} · {kfs.length} keyframes</span>
    </div>
    <div className="relative h-[calc(100%-33px)] overflow-hidden">
      <svg className="absolute inset-0 w-full h-full">
        <defs><pattern id={'grid-'+kind} width="40" height="24" patternUnits="userSpaceOnUse"><path d="M40 0H0V24" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="1"/></pattern></defs>
        <rect width="100%" height="100%" fill={'url(#grid-'+kind+')'}/>
        {kind==='curve' && kfs.length>1 && <polyline fill="none" stroke="#a78bfa" strokeWidth="2" points={kfs.map((kf,i)=>{
          const x=frameFromTime(kf.time,fps)/Math.max(totalFrames,1)*900;
          const raw=typeof kf.value==='number'?kf.value:i/(kfs.length-1);
          const y=130-Math.max(-1,Math.min(2,raw))*55;
          return x+','+y;
        }).join(' ')}/>}
      </svg>
      {kfs.map((kf,i)=>{
        const f=frameFromTime(kf.time,fps);
        const left=(f/Math.max(totalFrames,1)*100);
        const top=kind==='dope'?30+(i%4)*26:50+(i%3)*35;
        return <div key={kf.id} className="absolute w-2.5 h-2.5 rotate-45 bg-accent border border-background" style={{left:'calc('+left+'% - 5px)',top}} title={kf.property+' @ '+f+'f'}/>;
      })}
      <div className="absolute top-0 bottom-0 w-px bg-accent/80" style={{left:(currentFrame/Math.max(totalFrames,1)*100)+'%'}}/>
    </div>
  </div>;
}

function TraceStrip({doc}:{doc:MotionDocument}) {
  const entries=doc.contributionTrace?.entries ?? [];
  return <div className="flex flex-col h-full overflow-hidden bg-background/80">
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border"><GitBranch size={13} className="text-primary"/><span className="text-xs font-semibold">Contribution Trace</span><span className="text-[10px] text-muted-foreground">{entries.length} entries</span></div>
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {entries.length===0?<div className="text-xs text-muted-foreground">No authoring trace yet</div>:entries.slice(-20).reverse().map((e,i)=><div key={i} className="flex gap-2 py-1 text-[10px]"><span className="text-accent">{e.actor}</span><span className="text-foreground flex-1">{e.description}</span><span className="text-muted-foreground">{e.opsApplied} ops</span></div>)}
    </div>
  </div>;
}

export default function MotionAnimatorOriginalShell({handoff,onReturnToStudio}:Props){
  const engine=useEngine();
  const bridge=createMotionAnimatorHostBridge(engine,handoff);
  const doc=bridge.document;
  const [selectedId,setSelectedId]=useState<string|null>(handoff.selectedMotionObjectId ?? null);
  const [currentFrame,setCurrentFrame]=useState(()=>Math.round(handoff.clipLocalTimeSecs*(handoff.sequenceFormat.fps||30)));
  const [playing,setPlaying]=useState(false);
  const [showProperties,setShowProperties]=useState(true);
  const [showTrace,setShowTrace]=useState(true);
  const [proPanel,setProPanel]=useState<ProPanel>('none');
  const [drawer,setDrawer]=useState<Drawer>('none');
  const [hadEdits,setHadEdits]=useState(false);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);

  const fps=doc?.fps || handoff.sequenceFormat.fps || 30;
  const durationSecs=doc?motionTimeToSeconds(doc.duration):handoff.clipDurationSecs;
  const totalFrames=Math.max(1,Math.round(durationSecs*fps));
  const localSecs=currentFrame/fps;
  const frameState=doc?evaluateMotionDocument(doc,localSecs):null;
  const tracks=useMemo(()=>doc?docToTracks(doc):[],[doc?.updatedAt,doc?.id]);
  const selected=doc&&selectedId?doc.objects[selectedId]??null:null;

  useEffect(()=>{if(doc&&!selectedId)setSelectedId(doc.rootObjectIds[0]??Object.keys(doc.objects)[0]??null);},[doc?.id]);
  useEffect(()=>()=>{if(timer.current)clearInterval(timer.current);},[]);

  const stop=useCallback(()=>{if(timer.current)clearInterval(timer.current);timer.current=null;setPlaying(false);},[]);
  const play=useCallback(()=>{setPlaying(p=>{if(!p){timer.current=setInterval(()=>setCurrentFrame(f=>f>=totalFrames-1?0:f+1),1000/fps);return true;}if(timer.current)clearInterval(timer.current);timer.current=null;return false;});},[fps,totalFrames]);
  const seek=useCallback((f:number)=>{stop();setCurrentFrame(Math.max(0,Math.min(totalFrames-1,f)));},[stop,totalFrames]);
  const commit=useCallback((ops:ReturnType<typeof makeMotionOp>[],description:string)=>{if(bridge.commit(ops,description))setHadEdits(true);},[engine.project.revision,handoff.motionDocumentId]);

  if(!doc)return <div className="w-screen h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-3 text-muted-foreground"><AlertCircle/><span>MotionDocument not found</span><button className="px-3 py-2 rounded bg-primary/10 text-primary border border-primary/20" onClick={()=>onReturnToStudio(bridge.buildReturn(undefined,false))}>Return to Studio</button></div>;

  const toggleDrawer=(d:Drawer)=>setDrawer(x=>x===d?'none':d);
  const drawerContent=drawer==='text'?(selectedId?<TextMotionPanel clipId={handoff.clipId} objectId={selectedId}/>:null):
    drawer==='spatial'?<SpatialDepthPanel clipId={handoff.clipId}/>:
    drawer==='signals'?<SignalBindingPanel clipId={handoff.clipId}/>:
    drawer==='resources'?<SignalResourcePanel clipId={handoff.clipId}/>:
    drawer==='macros'?<CreativeMacrosPanel clipId={handoff.clipId}/>:
    drawer==='library'?<MotionLibrary/>:
    drawer==='scene'?<SceneScriptPanel/>:
    drawer==='trace'?<EvaluationTracePanel clipId={handoff.clipId} objectId={selectedId ?? undefined}/>:
    drawer==='ai'?<AICreativeOperatorPanel workspaceKind="motion-animator" motionHandoff={handoff}/>:
    drawer==='packages'?<LibraryPackagePanel workspaceKind="motion-animator" motionHandoff={handoff}/>:
    drawer==='svg'?<SVGPossibilityPanel/>:null;

  return <div className="flex flex-col w-screen h-screen overflow-hidden bg-background">
    {/* Original Motion Suite toolbar geometry; host controls added without rearranging it. */}
    <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50 flex-shrink-0 gap-2 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap">
        <button onClick={()=>setShowProperties(v=>!v)} className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium '+(showProperties?'bg-primary/10 text-primary':'text-muted-foreground hover:text-foreground hover:bg-secondary')}><PanelRight size={13}/>Properties</button>
        <button onClick={()=>setShowTrace(v=>!v)} className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium '+(showTrace?'bg-primary/10 text-primary':'text-muted-foreground hover:text-foreground hover:bg-secondary')}><PanelBottom size={13}/>Trace</button>
        <div className="w-px h-4 bg-border mx-1"/>
        <button onClick={()=>setProPanel(p=>p==='curve'?'none':'curve')} className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium '+(proPanel==='curve'?'bg-accent/10 text-accent':'text-muted-foreground hover:text-foreground hover:bg-secondary')}><BarChart2 size={13}/>Curves</button>
        <button onClick={()=>setProPanel(p=>p==='dopesheet'?'none':'dopesheet')} className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium '+(proPanel==='dopesheet'?'bg-accent/10 text-accent':'text-muted-foreground hover:text-foreground hover:bg-secondary')}><Layers size={13}/>Dope Sheet</button>
        <button onClick={()=>setProPanel(p=>p==='protools'?'none':'protools')} className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium '+(proPanel==='protools'?'bg-accent/10 text-accent':'text-muted-foreground hover:text-foreground hover:bg-secondary')}><Move size={13}/>Pro Tools</button>
        <div className="w-px h-4 bg-border mx-1"/>
        <button onClick={()=>toggleDrawer('library')} className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary">Assets</button>
        <button onClick={()=>toggleDrawer('text')} className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary">Text</button>
        <button onClick={()=>toggleDrawer('spatial')} className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary">2.5D</button>
        <button onClick={()=>toggleDrawer('signals')} className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary">Signals</button>
        <button onClick={()=>toggleDrawer('ai')} className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary">AI</button>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{doc.width}×{doc.height} · {fps}fps</span>
        <span className="font-mono text-xs text-accent bg-accent/10 px-2 py-0.5 rounded">{(localSecs).toFixed(2)}s</span>
        <button onClick={()=>bridge.undo()} disabled={bridge.undoDepth===0} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30">Undo</button>
        <button onClick={()=>bridge.redo()} disabled={bridge.redoDepth===0} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30">Redo</button>
        <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"><Settings2 size={14}/></button>
        <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"><Maximize2 size={14}/></button>
        <button onClick={()=>onReturnToStudio(bridge.buildReturn(selectedId??undefined,hadEdits))} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-primary/10 text-primary border border-primary/20">Return to Studio</button>
      </div>
    </div>

    {drawer!=='none' && <div className="flex-shrink-0 border-b border-border bg-card/80" style={{height:'34%'}}>
      <div className="h-full relative overflow-hidden">{drawerContent}<button onClick={()=>setDrawer('none')} className="absolute top-2 right-2 z-50 p-1 rounded bg-background/70 text-muted-foreground"><X size={12}/></button></div>
    </div>}

    {selected && <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-border bg-primary/5 text-xs">
      <div className="w-2 h-2 rounded-full" style={{backgroundColor:KIND_COLOR[selected.kind]??'#94a3b8'}}/>
      <span className="font-medium text-foreground">{selected.name}</span><span className="text-muted-foreground font-mono">{selected.kind}</span>
      <span className="text-muted-foreground">{selected.keyframes.length} keyframes</span><span className="text-muted-foreground">{selected.behaviors.length} behaviors</span>
      {proPanel!=='none'&&<span className="text-accent text-[10px]">→ {proPanel==='curve'?'Curve Editor':proPanel==='dopesheet'?'Dope Sheet':'Pro Tools'} wired to this object</span>}
    </div>}

    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex-shrink-0 border-b border-border" style={{height:'34%'}}><CanonicalCanvas doc={doc} frameState={frameState} currentFrame={currentFrame} totalFrames={totalFrames} selectedId={selectedId} onSelect={setSelectedId}/></div>
        <div className="flex-shrink-0 border-b border-border"><Transport playing={playing} currentFrame={currentFrame} totalFrames={totalFrames} fps={fps} onPlay={play} onStop={stop} onSeek={seek}/></div>
        {proPanel==='curve'&&<div className="flex-shrink-0 border-b border-border" style={{height:'32%'}}><KeyframePanel object={selected} fps={fps} totalFrames={totalFrames} currentFrame={currentFrame} kind="curve"/></div>}
        {proPanel==='dopesheet'&&<div className="flex-shrink-0 border-b border-border" style={{height:'32%'}}><KeyframePanel object={selected} fps={fps} totalFrames={totalFrames} currentFrame={currentFrame} kind="dope"/></div>}
        {proPanel==='protools'&&<div className="flex-shrink-0 border-b border-border p-3 bg-[#0a0a0f]" style={{height:'32%'}}><div className="h-full border border-border rounded-xl grid grid-cols-3 gap-3 p-3 text-xs"><div className="border border-border/50 rounded-lg p-3"><div className="font-semibold">Direct Manipulation</div><div className="text-muted-foreground mt-2">Canonical draft → one commit path active.</div></div><div className="border border-border/50 rounded-lg p-3"><div className="font-semibold">Relations</div><div className="text-muted-foreground mt-2">{doc.rigs?.length ?? 0} rigs in document.</div></div><div className="border border-border/50 rounded-lg p-3"><div className="font-semibold">Signals</div><div className="text-muted-foreground mt-2">{Object.keys(doc.signals).length} signal bindings/resources.</div></div></div></div>}
        <div className="flex-1 overflow-hidden"><AnimatorTimeline tracks={tracks} selectedId={selectedId} onSelect={setSelectedId} currentFrame={currentFrame} totalFrames={totalFrames} fps={fps}/></div>
        {showTrace&&<div className="flex-shrink-0 border-t border-border" style={{height:'18%'}}><TraceStrip doc={doc}/></div>}
      </div>
      {showProperties&&<div className="w-72 flex-shrink-0 border-l border-border overflow-hidden"><Inspector doc={doc} object={selected} commit={commit}/></div>}
    </div>
  </div>;
}
