# -*- coding: utf-8 -*-
p = r"src/app/main-editor/components/MotionAnimatorWorkspace.tsx"
s = open(p, encoding="utf-8").read()

# 0. import evaluateMotionTransform (value import) + MotionKeyframe type
old = """import type { MotionBehavior, MotionMaterial } from '@/engine/motion-document';"""
new = """import { evaluateMotionTransform } from '@/engine/motion-document';
import type { MotionBehavior, MotionMaterial, MotionKeyframe } from '@/engine/motion-document';"""
assert old in s, "motion-document import"
s = s.replace(old, new, 1)

# 1. CurveEditor: fix conditional hooks + add editing props/handlers
old = """function CurveEditor({
  doc,
  selectedObject,
  selection,
  onApplyOps,
  onToggleKeyframe,
}: {
  doc: MotionDocument;
  selectedObject: MotionObject | null;
  selection: MotionSelectionState;
  onApplyOps: (ops: ReturnType<typeof makeOp>[], description: string) => void;
  onToggleKeyframe: (kfId: string, additive: boolean) => void;
}) {
  if (!selectedObject) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select an object to view curves
      </div>
    );
  }

  const durationSecs = motionTimeToSeconds(doc.duration);
  // Build real curve tracks from canonical keyframes — no DEMO_TRACKS
  const curveTracks = useMemo(
    () => buildGraphCurveTracks(selectedObject, durationSecs, selection.selectedCurveTrackIds),
    [selectedObject, durationSecs, selection.selectedCurveTrackIds]
  );
"""
new = """function CurveEditor({
  doc,
  selectedObject,
  selection,
  playheadSecs,
  onApplyOps,
  onToggleKeyframe,
}: {
  doc: MotionDocument;
  selectedObject: MotionObject | null;
  selection: MotionSelectionState;
  playheadSecs: number;
  onApplyOps: (ops: ReturnType<typeof makeOp>[], description: string) => void;
  onToggleKeyframe: (kfId: string, additive: boolean) => void;
}) {
  const durationSecs = motionTimeToSeconds(doc.duration);
  // Build real curve tracks from canonical keyframes — no DEMO_TRACKS.
  // Hooks run unconditionally (rules of hooks): the selectedObject guard is
  // applied to the render, not to hook calls.
  const curveTracks = useMemo(
    () => (selectedObject ? buildGraphCurveTracks(selectedObject, durationSecs, selection.selectedCurveTrackIds) : []),
    [selectedObject, durationSecs, selection.selectedCurveTrackIds]
  );

  // Drag state: horizontal drag moves a keyframe in time, vertical drag edits
  // its value. Committed as ONE canonical op on pointer-up.
  const kfDragRef = useRef<{
    track: GraphCurveTrackViewModel;
    kfId: string;
    startX: number;
    startY: number;
    widthPx: number;
    moved: boolean;
  } | null>(null);

  const commitKeyframeMove = (track: GraphCurveTrackViewModel, kfId: string, newTimeSecs: number) => {
    if (!selectedObject) return;
    const clamped = Math.max(0, Math.min(durationSecs, newTimeSecs));
    onApplyOps(
      [makeOp('motion.keyframe.move', doc.id, { objectId: selectedObject.id, keyframeId: kfId, newTime: secondsToMotionTime(clamped) })],
      `Move keyframe (${track.property})`
    );
  };

  const commitKeyframeValue = (track: GraphCurveTrackViewModel, kfId: string, value: number) => {
    if (!selectedObject) return;
    const kf = selectedObject.keyframes.find((k) => k.id === kfId);
    if (!kf || typeof kf.value !== 'number') return;
    onApplyOps(
      [makeOp('motion.keyframe.upsert', doc.id, { objectId: selectedObject.id, keyframe: { ...kf, value } })],
      `Set keyframe value (${track.property})`
    );
  };

  const removeKeyframe = (track: GraphCurveTrackViewModel, kfId: string) => {
    if (!selectedObject) return;
    onApplyOps(
      [makeOp('motion.keyframe.remove', doc.id, { objectId: selectedObject.id, keyframeId: kfId })],
      `Remove keyframe (${track.property})`
    );
  };

  const addKeyframeAtPlayhead = (track: GraphCurveTrackViewModel) => {
    if (!selectedObject) return;
    const t = Math.max(0, Math.min(durationSecs, playheadSecs));
    const evaluated = evaluateMotionTransform(selectedObject, t) as unknown as Record<string, unknown>;
    const rawValue = evaluated[track.property];
    const keyframe: MotionKeyframe = {
      id: generateMotionId('kf'),
      time: secondsToMotionTime(t),
      property: track.property,
      value: typeof rawValue === 'number' ? rawValue : 0,
      easing: 'ease-in-out',
    };
    onApplyOps(
      [makeOp('motion.keyframe.upsert', doc.id, { objectId: selectedObject.id, keyframe })],
      `Add keyframe (${track.property}) @ playhead`
    );
  };

  if (!selectedObject) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', fontSize: '11px', color: 'var(--color-muted)' }}>
        Select an object to view curves
      </div>
    );
  }
"""
assert old in s, "curve editor head"
s = s.replace(old, new, 1)

# 2. CurveEditor keyframe dots: draggable + track header "+" button
old = """                {/* Keyframe dots */}
                {track.keyframes.map((kf) => {
                  const cx = kf.normalizedX * 300;
                  const cy = (1 - kf.normalizedY) * 60;
                  const isKfSelected = selection.selectedKeyframeIds.has(kf.id);
                  return (
                    <circle
                      key={kf.id}
                      cx={cx}
                      cy={cy}
                      r={isKfSelected ? 5 : 3}
                      fill={isKfSelected ? '#fff' : track.color}
                      stroke={isKfSelected ? track.color : 'none'}
                      strokeWidth="1.5"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => onToggleKeyframe(kf.id, e.shiftKey)}
                    />
                  );
                })}"""
new = """                {/* Keyframe dots — drag horizontally to move in time, vertically to edit value */}
                {track.keyframes.map((kf) => {
                  const cx = kf.normalizedX * 300;
                  const cy = (1 - kf.normalizedY) * 60;
                  const isKfSelected = selection.selectedKeyframeIds.has(kf.id);
                  return (
                    <circle
                      key={kf.id}
                      cx={cx}
                      cy={cy}
                      r={isKfSelected ? 5 : 3}
                      fill={isKfSelected ? '#fff' : track.color}
                      stroke={isKfSelected ? track.color : 'none'}
                      strokeWidth="1.5"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => {
                        const svg = e.currentTarget.ownerSVGElement;
                        kfDragRef.current = {
                          track,
                          kfId: kf.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          widthPx: svg?.clientWidth ?? 300,
                          moved: false,
                        };
                        (e.target as Element).setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        const drag = kfDragRef.current;
                        if (!drag || drag.kfId !== kf.id) return;
                        if (Math.abs(e.clientX - drag.startX) > 2 || Math.abs(e.clientY - drag.startY) > 2) drag.moved = true;
                      }}
                      onPointerUp={(e) => {
                        const drag = kfDragRef.current;
                        kfDragRef.current = null;
                        if (!drag || drag.kfId !== kf.id) return;
                        if (!drag.moved) {
                          onToggleKeyframe(kf.id, e.shiftKey);
                          return;
                        }
                        const width = Math.max(1, drag.widthPx);
                        const dxNorm = (e.clientX - drag.startX) / width;
                        const dyNorm = (e.clientY - drag.startY) / 60;
                        const newTime = kf.timeSecs + dxNorm * durationSecs;
                        commitKeyframeMove(drag.track, kf.id, newTime);
                        if (Math.abs(dyNorm) > 0.02) {
                          const valueRange = (drag.track.valueMax - drag.track.valueMin) || 1;
                          const newValue = kf.value - dyNorm * valueRange;
                          commitKeyframeValue(drag.track, kf.id, newValue);
                        }
                      }}
                    />
                  );
                })}"""
assert old in s, "kf dots"
s = s.replace(old, new, 1)

# 3. track header: add-at-playhead button
old = """              <span>{track.label}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                {track.valueMin.toFixed(2)} → {track.valueMax.toFixed(2)}
              </span>"""
new = """              <span>{track.label}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '9px', color: 'var(--color-subtle)' }}>
                  {track.valueMin.toFixed(2)} → {track.valueMax.toFixed(2)}
                </span>
                <button
                  onClick={() => addKeyframeAtPlayhead(track)}
                  title="Add keyframe at playhead"
                  style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '3px', color: track.color, fontSize: '9px', cursor: 'pointer', padding: '0 4px', lineHeight: '14px' }}
                >
                  +kf
                </button>
              </span>"""
assert old in s, "track header"
s = s.replace(old, new, 1)

# 4. keyframe list rows: inline value edit + delete
old = """                <span style={{ fontFamily: 'monospace', color: track.color, minWidth: '40px' }}>{kf.timeSecs.toFixed(2)}s</span>
                <span style={{ flex: 1 }}>{kf.value.toFixed(3)}</span>
                <span style={{ color: 'var(--color-subtle)' }}>{kf.easing}</span>
              </div>
            ))}"""
new = """                <span style={{ fontFamily: 'monospace', color: track.color, minWidth: '40px' }}>{kf.timeSecs.toFixed(2)}s</span>
                <input
                  key={`${kf.id}:${kf.value}`}
                  defaultValue={kf.value.toFixed(3)}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isFinite(v) && Math.abs(v - kf.value) > 1e-6) commitKeyframeValue(track, kf.id, v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  style={{ flex: 1, minWidth: 0, background: 'transparent', border: '1px solid transparent', borderRadius: '2px', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', padding: '0 2px' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.select(); }}
                  onBlurCapture={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                />
                <span style={{ color: 'var(--color-subtle)' }}>{kf.easing}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeKeyframe(track, kf.id); }}
                  title="Delete keyframe"
                  style={{ background: 'none', border: 'none', color: 'var(--color-subtle)', cursor: 'pointer', fontSize: '10px', padding: '0 2px' }}
                >
                  ✕
                </button>
              </div>
            ))}"""
assert old in s, "kf rows"
s = s.replace(old, new, 1)

open(p, "w", encoding="utf-8", newline="").write(s)
print("CurveEditor ok")
