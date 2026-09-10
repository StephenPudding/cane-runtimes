import type {
  RuntimeAnimationV1,
  RuntimeEventKeyV1,
  RuntimeEventV1,
  RuntimeMixV1,
  RuntimeQueueEmptyAnimationV1,
  RuntimeQueueAnimationV1,
  RuntimeQueuedEntryOptionsV1,
  RuntimeQueuedTrackEntryV1,
  RuntimeSamplingV1,
  RuntimeSetAnimationV1,
  RuntimeSetEmptyAnimationV1,
  RuntimeSetTrackAnimationRangeV1,
  RuntimeSetTrackEndV1,
  RuntimeSetTrackMixDurationV1,
  RuntimeTrackOptionsV1,
  RuntimeTrackStateV1,
} from "../contracts.js";
import type { RuntimeDataV1 } from "../data.js";
import { RuntimeErrorV1 } from "../errors.js";
import { finiteF32, f32, f32Add, f32Mul } from "../math/f32.js";
import { quantizeSampleTimeV1 } from "./curves.js";
import type { RuntimeAnimationLayerV1 } from "./sampling.js";

const MAX_TRACK_INDEX = 4095;
const MAX_EVENTS_PER_OPERATION = 1_000_000;
const F32_MAX = Math.fround(3.4028234663852886e38);
const AUTHORED_SAMPLING_V1: RuntimeSamplingV1 = Object.freeze({ mode: "authored" });
const AUTHORED_PLAN_V1: RuntimeSamplingPlanV1 = Object.freeze({ forceStepped: false, frameStepSeconds: null });
const FORCE_STEPPED_PLAN_V1: RuntimeSamplingPlanV1 = Object.freeze({ forceStepped: true, frameStepSeconds: null });
const FIXED_SAMPLING_PLAN_CACHE = new WeakMap<object, RuntimeSamplingPlanV1>();

type MutableAnimationLayerV1 = { -readonly [Property in keyof RuntimeAnimationLayerV1]: RuntimeAnimationLayerV1[Property] };

interface RuntimePropertyAlphaScratchV1 {
  controllerOwned: ReadonlySet<string> | null;
  readonly lowerOwned: Set<string>;
  controllerProgress: number;
  holdPrevious: boolean;
}

interface ReusableAnimationLayerV1 extends MutableAnimationLayerV1 {
  readonly propertyAlphaScratch: RuntimePropertyAlphaScratchV1;
  readonly propertyAlphaCallback: (propertyId: string, alpha: number) => number;
}

interface TrackEntryV1 {
  animation: RuntimeAnimationV1 | null;
  animationStart: number;
  animationEnd: number;
  trackTime: number;
  delay: number;
  trackEnd: number;
  timeScale: number;
  looping: boolean;
  alpha: number;
  blend: "replace" | "additive";
  mixDuration: number;
  mixTime: number;
  eventThreshold: number;
  attachmentThreshold: number;
  drawOrderThreshold: number;
  holdPrevious: boolean;
  eventCursorInitialized: boolean;
  mixingFrom: TrackEntryV1 | null;
}

interface QueuedEntryV1 {
  animation: RuntimeAnimationV1 | null;
  looping: boolean;
  delay: number;
  mixDuration: number;
}

interface TrackV1 {
  current: TrackEntryV1 | null;
  queue: QueuedEntryV1[];
}

interface PendingEventV1 {
  readonly wallOffset: number;
  readonly trackIndex: number;
  readonly ordinal: number;
  readonly event: RuntimeEventV1;
}

interface OutgoingControllerV1 {
  readonly entry: TrackEntryV1;
  readonly mixTimeAtStart: number;
}

export interface RuntimeSamplingPlanV1 {
  readonly forceStepped: boolean;
  readonly frameStepSeconds: number | null;
}

/** Internal mutable projection used to avoid allocating a public track snapshot per frame. */
export interface RuntimePrimaryClockV1 {
  animationId: string | null;
  trackTime: number;
  duration: number;
  looping: boolean;
}

export class RuntimeAnimationStateV1 {
  readonly #data: RuntimeDataV1;
  readonly #tracks = new Map<number, TrackV1>();
  readonly #sortedTrackIndicesCache: number[] = [];
  readonly #chainScratch: TrackEntryV1[] = [];
  readonly #layerPool: ReusableAnimationLayerV1[] = [];
  readonly #layersScratch: MutableAnimationLayerV1[] = [];
  readonly #lowerOwnedScratch = new Set<string>();
  readonly #eventCollectorScratch = new EventCollectorV1(MAX_EVENTS_PER_OPERATION);
  #defaultMix = 0;
  #detachedTime = 0;
  readonly #pairMixes = new Map<string, number>();
  readonly #pairMixKeys: string[] = [];

  constructor(data: RuntimeDataV1) {
    this.#data = data;
  }

  clone(): RuntimeAnimationStateV1 {
    const result = new RuntimeAnimationStateV1(this.#data);
    result.#defaultMix = this.#defaultMix;
    result.#detachedTime = this.#detachedTime;
    for (let index = 0; index < this.#pairMixKeys.length; index += 1) {
      const key = this.#pairMixKeys[index];
      if (key === undefined) continue;
      const duration = this.#pairMixes.get(key);
      if (duration !== undefined) result.#setPairMix(key, duration);
    }
    for (const [index, track] of this.#tracks) {
      result.#tracks.set(index, {
        current: cloneEntry(track.current),
        queue: track.queue.map((queued) => ({ ...queued })),
      });
    }
    return result;
  }

  /**
   * Copies logical playback/configuration state into retained storage.
   * Performance-mode transactions alternate two instances, so a stable
   * track/queue shape performs no object or array allocation after warm-up.
   */
  copyFrom(source: RuntimeAnimationStateV1): this {
    if (source.#data !== this.#data) {
      throw new RuntimeErrorV1("invalidArgument", "copyAnimationState", "Animation states use different Runtime data.");
    }
    this.#defaultMix = source.#defaultMix;
    this.#detachedTime = source.#detachedTime;
    const sourcePairMixKeys = source.#pairMixKeys;
    let samePairMixShape = this.#pairMixKeys.length === sourcePairMixKeys.length;
    if (samePairMixShape) {
      for (let index = 0; index < sourcePairMixKeys.length; index += 1) {
        if (this.#pairMixKeys[index] !== sourcePairMixKeys[index]) {
          samePairMixShape = false;
          break;
        }
      }
    }
    if (!samePairMixShape) {
      for (let index = 0; index < this.#pairMixKeys.length; index += 1) {
        const key = this.#pairMixKeys[index];
        if (key !== undefined && !source.#pairMixes.has(key)) this.#pairMixes.delete(key);
      }
      this.#pairMixKeys.length = sourcePairMixKeys.length;
      for (let index = 0; index < sourcePairMixKeys.length; index += 1) {
        const key = sourcePairMixKeys[index];
        if (key !== undefined) this.#pairMixKeys[index] = key;
      }
    }
    for (let index = 0; index < sourcePairMixKeys.length; index += 1) {
      const key = sourcePairMixKeys[index];
      if (key === undefined) continue;
      const duration = source.#pairMixes.get(key);
      if (duration !== undefined) this.#pairMixes.set(key, duration);
    }

    const sourceTrackIndices = source.#sortedTrackIndices();
    const targetTrackIndices = this.#sortedTrackIndices();
    let sameTrackShape = sourceTrackIndices.length === targetTrackIndices.length;
    if (sameTrackShape) {
      for (let index = 0; index < sourceTrackIndices.length; index += 1) {
        if (sourceTrackIndices[index] !== targetTrackIndices[index]) {
          sameTrackShape = false;
          break;
        }
      }
    }
    if (!sameTrackShape) {
      for (let index = 0; index < targetTrackIndices.length; index += 1) {
        const trackIndex = targetTrackIndices[index];
        if (trackIndex !== undefined && !source.#tracks.has(trackIndex)) this.#tracks.delete(trackIndex);
      }
    }
    for (let position = 0; position < sourceTrackIndices.length; position += 1) {
      const index = sourceTrackIndices[position];
      if (index === undefined) continue;
      const sourceTrack = source.#tracks.get(index);
      if (sourceTrack === undefined) continue;
      let targetTrack = this.#tracks.get(index);
      if (targetTrack === undefined) {
        targetTrack = { current: null, queue: [] };
        this.#tracks.set(index, targetTrack);
      }
      targetTrack.current = copyEntryIntoV1(targetTrack.current, sourceTrack.current);
      targetTrack.queue.length = sourceTrack.queue.length;
      for (let queueIndex = 0; queueIndex < sourceTrack.queue.length; queueIndex += 1) {
        const sourceQueued = sourceTrack.queue[queueIndex];
        if (sourceQueued === undefined) continue;
        let targetQueued = targetTrack.queue[queueIndex];
        if (targetQueued === undefined) {
          targetQueued = { animation: null, looping: false, delay: 0, mixDuration: 0 };
          targetTrack.queue[queueIndex] = targetQueued;
        }
        targetQueued.animation = sourceQueued.animation;
        targetQueued.looping = sourceQueued.looping;
        targetQueued.delay = sourceQueued.delay;
        targetQueued.mixDuration = sourceQueued.mixDuration;
      }
    }
    this.#sortedTrackIndicesCache.length = sourceTrackIndices.length;
    for (let index = 0; index < sourceTrackIndices.length; index += 1) {
      const trackIndex = sourceTrackIndices[index];
      if (trackIndex !== undefined) this.#sortedTrackIndicesCache[index] = trackIndex;
    }
    return this;
  }

  /** Rebinds still-valid animation entries and mixes to a replacement immutable data set. */
  reconciled(data: RuntimeDataV1): RuntimeAnimationStateV1 {
    const result = new RuntimeAnimationStateV1(data);
    result.#defaultMix = this.#defaultMix;
    result.#detachedTime = this.#detachedTime;
    for (let index = 0; index < this.#pairMixKeys.length; index += 1) {
      const key = this.#pairMixKeys[index];
      if (key === undefined) continue;
      const duration = this.#pairMixes.get(key);
      if (duration === undefined) continue;
      const [from, to] = parsePairKeyV1(key);
      if (hasAnimationV1(data, from) && hasAnimationV1(data, to)) result.#setPairMix(key, duration);
    }
    for (const [index, track] of this.#tracks) {
      const current = reconcileEntryV1(track.current, data);
      result.#tracks.set(index, {
        current,
        queue: current === null
          ? []
          : track.queue.flatMap((queued) => {
              if (queued.animation === null) return [{ ...queued }];
              const animation = findAnimationV1(data, queued.animation.id);
              return animation === null ? [] : [{ ...queued, animation }];
            }),
      });
    }
    return result;
  }

  /** Copies only default/pair mix configuration into a fresh trackless state. */
  configurationClone(data: RuntimeDataV1): RuntimeAnimationStateV1 {
    const result = new RuntimeAnimationStateV1(data);
    result.#defaultMix = this.#defaultMix;
    for (let index = 0; index < this.#pairMixKeys.length; index += 1) {
      const key = this.#pairMixKeys[index];
      if (key === undefined) continue;
      const duration = this.#pairMixes.get(key);
      if (duration === undefined) continue;
      const [from, to] = parsePairKeyV1(key);
      if (hasAnimationV1(data, from) && hasAnimationV1(data, to)) result.#setPairMix(key, duration);
    }
    return result;
  }

  setAnimation(request: RuntimeSetAnimationV1): RuntimeEventV1[] {
    const trackIndex = validateTrackIndex(request.trackIndex, "setAnimation");
    const animation = this.#lookupAnimation(request.animationId, "setAnimation");
    if (typeof request.looping !== "boolean") invalid("setAnimation", "looping", "looping must be boolean.");
    const track = this.#track(trackIndex);
    const outgoing = track.current;
    const mixDuration = request.mixSeconds === undefined || request.mixSeconds === null
      ? (outgoing === null || outgoing.animation === null ? 0 : this.#mixDuration(outgoing.animation.id, animation.id))
      : nonNegative(request.mixSeconds, "setAnimation", "mixSeconds");
    const events: RuntimeEventV1[] = [];
    if (outgoing !== null) {
      events.push(lifecycle(trackIndex, animationIdV1(outgoing), "interrupt"));
    }
    const entry = createEntry(animation, request.looping, mixDuration);
    if (outgoing !== null) {
      if (mixDuration === 0) disposeStartedChain(outgoing, trackIndex, events);
      else entry.mixingFrom = outgoing;
    }
    for (const queued of track.queue) events.push(lifecycle(trackIndex, queued.animation?.id ?? null, "dispose"));
    track.queue.length = 0;
    track.current = entry;
    this.#detachedTime = 0;
    events.push(lifecycle(trackIndex, animation.id, "start"));
    return events;
  }

  setEmptyAnimation(request: RuntimeSetEmptyAnimationV1): RuntimeEventV1[] {
    const trackIndex = validateTrackIndex(request.trackIndex, "setEmptyAnimation");
    const mixDuration = nonNegative(request.mixDurationSeconds, "setEmptyAnimation", "mixDurationSeconds");
    const track = this.#track(trackIndex);
    const outgoing = track.current;
    const events: RuntimeEventV1[] = [];
    if (outgoing !== null) events.push(lifecycle(trackIndex, animationIdV1(outgoing), "interrupt"));
    const entry = createEmptyEntry(mixDuration);
    if (outgoing !== null) {
      if (mixDuration === 0) disposeStartedChain(outgoing, trackIndex, events);
      else entry.mixingFrom = outgoing;
    }
    for (const queued of track.queue) events.push(lifecycle(trackIndex, queued.animation?.id ?? null, "dispose"));
    track.queue.length = 0;
    track.current = entry;
    events.push(lifecycle(trackIndex, null, "start"));
    return events;
  }

  queueAnimation(request: RuntimeQueueAnimationV1): RuntimeEventV1[] {
    const trackIndex = validateTrackIndex(request.trackIndex, "queueAnimation");
    const animation = this.#lookupAnimation(request.animationId, "queueAnimation");
    if (typeof request.looping !== "boolean") invalid("queueAnimation", "looping", "looping must be boolean.");
    const delayInput = finite(request.delaySeconds, "queueAnimation", "delaySeconds");
    const track = this.#track(trackIndex);
    if (track.current === null) {
      return this.setAnimation({ trackIndex, animationId: animation.id, looping: request.looping });
    }
    const current = track.current;
    const previous = track.queue[track.queue.length - 1];
    const previousAnimation = previous === undefined ? current.animation : previous.animation;
    const previousDuration = previous === undefined ? entryRangeDurationV1(current) : queuedRangeDurationV1(previous);
    const mixDuration = previousAnimation === null ? 0 : this.#mixDuration(previousAnimation.id, animation.id);
    const delay = delayInput > 0
      ? delayInput
      : f32(Math.max(0, f32Add(previousDuration, f32Add(-mixDuration, delayInput))));
    track.queue.push({ animation, looping: request.looping, delay, mixDuration });
    return [];
  }

  queueEmptyAnimation(request: RuntimeQueueEmptyAnimationV1): RuntimeEventV1[] {
    const trackIndex = validateTrackIndex(request.trackIndex, "queueEmptyAnimation");
    const mixDuration = nonNegative(request.mixDurationSeconds, "queueEmptyAnimation", "mixDurationSeconds");
    const delayInput = finite(request.delaySeconds, "queueEmptyAnimation", "delaySeconds");
    const track = this.#track(trackIndex);
    if (track.current === null) return this.setEmptyAnimation({ trackIndex, mixDurationSeconds: mixDuration });
    const current = track.current;
    const previous = track.queue[track.queue.length - 1];
    const previousDuration = previous === undefined ? entryRangeDurationV1(current) : queuedRangeDurationV1(previous);
    const delay = delayInput > 0
      ? delayInput
      : f32(Math.max(0, f32Add(previousDuration, f32Add(-mixDuration, delayInput))));
    track.queue.push({ animation: null, looping: false, delay, mixDuration });
    return [];
  }

  removeQueuedEntry(trackIndexValue: number, queueIndexValue: number): RuntimeEventV1[] {
    const trackIndex = validateTrackIndex(trackIndexValue, "removeQueuedEntry");
    const queueIndex = validateQueueIndex(queueIndexValue, "removeQueuedEntry");
    const track = this.#tracks.get(trackIndex);
    const removed = track?.queue.splice(queueIndex, 1)[0];
    if (removed === undefined) queuedNotFound("removeQueuedEntry", queueIndex);
    return [lifecycle(trackIndex, removed.animation?.id ?? null, "dispose")];
  }

  setQueuedEntryOptions(request: RuntimeQueuedEntryOptionsV1): void {
    const operation = "setQueuedEntryOptions";
    const trackIndex = validateTrackIndex(request.trackIndex, operation);
    const queueIndex = validateQueueIndex(request.queueIndex, operation);
    if ((request.delaySeconds === undefined || request.delaySeconds === null)
      && (request.mixDurationSeconds === undefined || request.mixDurationSeconds === null)
      && (request.looping === undefined || request.looping === null)) {
      invalid(operation, "options", "At least one queued entry option must be present.");
    }
    const queued = this.#tracks.get(trackIndex)?.queue[queueIndex];
    if (queued === undefined) queuedNotFound(operation, queueIndex);
    if (request.delaySeconds !== undefined && request.delaySeconds !== null) {
      queued.delay = nonNegative(request.delaySeconds, operation, "delaySeconds");
    }
    if (request.mixDurationSeconds !== undefined && request.mixDurationSeconds !== null) {
      queued.mixDuration = nonNegative(request.mixDurationSeconds, operation, "mixDurationSeconds");
    }
    if (request.looping !== undefined && request.looping !== null) {
      if (typeof request.looping !== "boolean") invalid(operation, "looping", "looping must be boolean.");
      queued.looping = request.looping;
    }
  }

  clearTrack(trackIndexValue: number): RuntimeEventV1[] {
    const trackIndex = validateTrackIndex(trackIndexValue, "clearTrack");
    const track = this.#tracks.get(trackIndex);
    if (track === undefined) return [];
    const events: RuntimeEventV1[] = [];
    if (track.current !== null) disposeStartedChain(track.current, trackIndex, events);
    for (const queued of track.queue) events.push(lifecycle(trackIndex, queued.animation?.id ?? null, "dispose"));
    track.current = null;
    track.queue.length = 0;
    return events;
  }

  clearTracks(): RuntimeEventV1[] {
    const events: RuntimeEventV1[] = [];
    for (const trackIndex of this.#sortedTrackIndices()) events.push(...this.clearTrack(trackIndex));
    return events;
  }

  setDefaultMix(durationSeconds: number): void {
    this.#defaultMix = nonNegative(durationSeconds, "setDefaultMix", "durationSeconds");
  }

  defaultMixSeconds(): number {
    return this.#defaultMix;
  }

  animationTime(): number {
    const primary = this.#tracks.get(0)?.current;
    return primary === undefined || primary === null ? this.#detachedTime : poseTime(primary);
  }

  /** Writes only the clock fields needed by Runtime physics; no snapshot object is created. */
  writePrimaryClock(detachedTime: number, output: RuntimePrimaryClockV1): void {
    const primary = this.#tracks.get(0)?.current;
    output.animationId = primary?.animation?.id ?? null;
    output.trackTime = primary === undefined || primary === null ? detachedTime : primary.trackTime;
    output.duration = primary === undefined || primary === null ? 0 : entryRangeDurationV1(primary);
    output.looping = primary?.looping ?? false;
  }

  hasActiveEntries(): boolean {
    for (const track of this.#tracks.values()) {
      if (track.current !== null) return true;
    }
    return false;
  }

  setMix(request: RuntimeMixV1): void {
    this.#lookupAnimation(request.fromAnimationId, "setMix");
    this.#lookupAnimation(request.toAnimationId, "setMix");
    const duration = nonNegative(request.durationSeconds, "setMix", "durationSeconds");
    this.#setPairMix(pairKey(request.fromAnimationId, request.toAnimationId), duration);
  }

  setTrackTime(trackIndexValue: number, timeSeconds: number): void {
    const trackIndex = validateTrackIndex(trackIndexValue, "setTrackTime");
    const entry = this.#requireCurrent(trackIndex, "setTrackTime");
    entry.trackTime = nonNegative(timeSeconds, "setTrackTime", "timeSeconds");
    entry.eventCursorInitialized = true;
  }

  setAnimationTime(timeSeconds: number): void {
    const time = nonNegative(timeSeconds, "setAnimationTime", "timeSeconds");
    this.#detachedTime = time;
    const entry = this.#tracks.get(0)?.current;
    if (entry === undefined || entry === null) return;
    entry.trackTime = f32(Math.max(0, Math.min(Math.max(time, entry.animationStart), entry.animationEnd) - entry.animationStart));
    entry.eventCursorInitialized = true;
  }

  setTrackMixDuration(request: RuntimeSetTrackMixDurationV1): void {
    const entry = this.#requireCurrent(validateTrackIndex(request.trackIndex, "setTrackMixDuration"), "setTrackMixDuration");
    entry.mixDuration = nonNegative(request.mixDurationSeconds, "setTrackMixDuration", "mixDurationSeconds");
  }

  setTrackEnd(request: RuntimeSetTrackEndV1): void {
    const entry = this.#requireCurrent(validateTrackIndex(request.trackIndex, "setTrackEnd"), "setTrackEnd");
    entry.trackEnd = request.trackEndSeconds === null
      ? F32_MAX
      : nonNegative(request.trackEndSeconds, "setTrackEnd", "trackEndSeconds");
  }

  setTrackAnimationRange(request: RuntimeSetTrackAnimationRangeV1): void {
    const operation = "setTrackAnimationRange";
    const entry = this.#requireCurrent(validateTrackIndex(request.trackIndex, operation), operation);
    const current = poseTime(entry);
    if (request.range === null) {
      entry.animationStart = 0;
      entry.animationEnd = entry.animation?.duration ?? 0;
      entry.trackTime = f32(Math.min(Math.max(current, 0), entry.animationEnd));
      entry.eventCursorInitialized = true;
      return;
    }
    if (request.range === undefined || typeof request.range !== "object") {
      invalid(operation, "range", "range must be an object or null.");
    }
    const start = nonNegative(request.range.startSeconds, operation, "range.startSeconds");
    const end = nonNegative(request.range.endSeconds, operation, "range.endSeconds");
    const duration = entry.animation?.duration ?? 0;
    if (!(end > start) || end > duration) {
      invalid(operation, "range", "Animation range must be non-empty and fit the current animation.");
    }
    entry.animationStart = start;
    entry.animationEnd = end;
    entry.trackTime = f32(Math.max(0, Math.min(Math.max(current, start), end) - start));
    entry.eventCursorInitialized = true;
  }

  setTrackOptions(request: RuntimeTrackOptionsV1): void {
    const trackIndex = validateTrackIndex(request.trackIndex, "setTrackOptions");
    const entry = this.#requireCurrent(trackIndex, "setTrackOptions");
    if (request.alpha !== undefined && request.alpha !== null) entry.alpha = unit(request.alpha, "setTrackOptions", "alpha");
    if (request.timeScale !== undefined && request.timeScale !== null) entry.timeScale = finite(request.timeScale, "setTrackOptions", "timeScale");
    if (request.looping !== undefined && request.looping !== null) {
      if (typeof request.looping !== "boolean") invalid("setTrackOptions", "looping", "looping must be boolean.");
      entry.looping = request.looping;
    }
    if (request.blend !== undefined && request.blend !== null) {
      if (request.blend !== "replace" && request.blend !== "additive") invalid("setTrackOptions", "blend", "Unknown track blend mode.");
      entry.blend = request.blend;
    }
    if (request.eventThreshold !== undefined && request.eventThreshold !== null) {
      entry.eventThreshold = unit(request.eventThreshold, "setTrackOptions", "eventThreshold");
    }
    if (request.attachmentThreshold !== undefined && request.attachmentThreshold !== null) {
      entry.attachmentThreshold = unit(request.attachmentThreshold, "setTrackOptions", "attachmentThreshold");
    }
    if (request.drawOrderThreshold !== undefined && request.drawOrderThreshold !== null) {
      entry.drawOrderThreshold = unit(request.drawOrderThreshold, "setTrackOptions", "drawOrderThreshold");
    }
    if (request.holdPrevious !== undefined && request.holdPrevious !== null) {
      if (typeof request.holdPrevious !== "boolean") invalid("setTrackOptions", "holdPrevious", "holdPrevious must be boolean.");
      entry.holdPrevious = request.holdPrevious;
    }
  }

  trackState(trackIndexValue: number): RuntimeTrackStateV1 | null {
    const trackIndex = validateTrackIndex(trackIndexValue, "queryTrackState");
    const track = this.#tracks.get(trackIndex);
    if (track === undefined || track.current === null) return null;
    const entry = track.current;
    return {
      trackIndex,
      animationId: entry.animation?.id ?? null,
      animationTimeSeconds: poseTime(entry),
      animationDurationSeconds: entryRangeDurationV1(entry),
      animationStartSeconds: entry.animationStart,
      animationEndSeconds: entry.animationEnd,
      trackTimeSeconds: entry.trackTime,
      delaySeconds: entry.delay,
      trackEndSeconds: entry.trackEnd,
      timeScale: entry.timeScale,
      alpha: entry.alpha,
      looping: entry.looping,
      blend: entry.blend,
      mixDurationSeconds: entry.mixDuration,
      mixTimeSeconds: entry.mixTime,
      mixProgress: mixProgress(entry),
      eventThreshold: entry.eventThreshold,
      attachmentThreshold: entry.attachmentThreshold,
      drawOrderThreshold: entry.drawOrderThreshold,
      holdPrevious: entry.holdPrevious,
      queuedCount: track.queue.length,
    };
  }

  queuedEntries(trackIndexValue: number): RuntimeQueuedTrackEntryV1[] {
    const trackIndex = validateTrackIndex(trackIndexValue, "queryQueuedEntries");
    return (this.#tracks.get(trackIndex)?.queue ?? []).map((entry, queueIndex) => ({
      trackIndex,
      queueIndex,
      animationId: entry.animation?.id ?? null,
      delaySeconds: entry.delay,
      mixDurationSeconds: entry.mixDuration,
      looping: entry.looping,
    }));
  }

  trackCount(): number {
    if (this.#tracks.size === 0) return 0;
    return Math.max(...this.#tracks.keys()) + 1;
  }

  update(
    deltaSeconds: number,
    maxEmittedEvents = MAX_EVENTS_PER_OPERATION,
    reuseOutput = false,
  ): RuntimeEventV1[] {
    const delta = nonNegative(deltaSeconds, "update", "deltaSeconds");
    if (!Number.isInteger(maxEmittedEvents) || maxEmittedEvents < 0 || maxEmittedEvents > MAX_EVENTS_PER_OPERATION) {
      throw new RuntimeErrorV1("invalidArgument", "update", "maxEmittedEvents is outside the supported range.", {
        field: "maxEmittedEvents",
      });
    }
    if (!this.hasActiveEntries()) {
      const nextTime = f32Add(this.#detachedTime, delta);
      if (!Number.isFinite(nextTime)) {
        throw new RuntimeErrorV1("nonFinite", "update", "The detached animation clock exceeded binary32 range.", {
          field: "deltaSeconds",
        });
      }
      this.#detachedTime = Math.max(0, nextTime);
      if (reuseOutput) return this.#eventCollectorScratch.reset(maxEmittedEvents).finish(true);
      return [];
    }
    const collector = reuseOutput
      ? this.#eventCollectorScratch.reset(maxEmittedEvents)
      : new EventCollectorV1(maxEmittedEvents);
    const trackIndices = this.#sortedTrackIndices();
    for (let index = 0; index < trackIndices.length; index += 1) {
      const trackIndex = trackIndices[index];
      if (trackIndex === undefined) continue;
      const track = this.#tracks.get(trackIndex);
      if (track !== undefined) this.#advanceTrack(trackIndex, track, delta, collector);
    }
    return collector.finish(reuseOutput);
  }

  layers(
    sampling: RuntimeSamplingV1 = AUTHORED_SAMPLING_V1,
    reuseOutput = false,
  ): RuntimeAnimationLayerV1[] {
    const plan = samplingPlanV1(sampling);
    const layers: MutableAnimationLayerV1[] = reuseOutput ? this.#layersScratch : [];
    let layerCount = 0;
    const trackIndices = this.#sortedTrackIndices();
    let needsOwnership = false;
    for (let index = 0; index < trackIndices.length; index += 1) {
      const trackIndex = trackIndices[index];
      if (trackIndex === undefined) continue;
      const current = this.#tracks.get(trackIndex)?.current;
      if (current !== undefined && current !== null && current.mixingFrom !== null) {
        needsOwnership = true;
        break;
      }
    }
    const lowerOwned = reuseOutput ? this.#lowerOwnedScratch : new Set<string>();
    if (reuseOutput && needsOwnership) lowerOwned.clear();
    for (let trackPosition = 0; trackPosition < trackIndices.length; trackPosition += 1) {
      const trackIndex = trackIndices[trackPosition];
      if (trackIndex === undefined) continue;
      const current = this.#tracks.get(trackIndex)?.current;
      if (current === undefined || current === null) continue;
      const chain = flattenChainInto(current, reuseOutput ? this.#chainScratch : []);
      const strictLowerOwnedSnapshot = !reuseOutput && chain.length > 1
        ? new Set(lowerOwned)
        : lowerOwned;
      for (let index = 0; index < chain.length; index += 1) {
        const entry = chain[index];
        if (entry === undefined) continue;
        const controller = chain[index + 1];
        const entryProgress = entry.mixingFrom === null ? 1 : mixProgress(entry);
        const baseAlpha = f32Mul(entry.alpha, entryProgress);
        const controllerOwned = controller?.animation == null ? null : ownedProperties(controller.animation);
        const controllerProgress = controller === undefined ? 1 : mixProgress(controller);
        if (entry.animation === null) continue;
        let sampleTime = poseTime(entry);
        if (plan.frameStepSeconds !== null) sampleTime = quantizeSampleTimeV1(sampleTime, plan.frameStepSeconds);
        const layerIndex = layerCount;
        let sampledLayer: MutableAnimationLayerV1 | undefined = reuseOutput
          ? this.#layerPool[layerIndex]
          : undefined;
        if (sampledLayer === undefined) {
          if (reuseOutput) {
            const propertyAlphaScratch: RuntimePropertyAlphaScratchV1 = {
              controllerOwned: null,
              lowerOwned: new Set(),
              controllerProgress: 1,
              holdPrevious: false,
            };
            const reusable: ReusableAnimationLayerV1 = {
              animation: entry.animation,
              sampleTime,
              alpha: baseAlpha,
              blend: entry.blend,
              forceStepped: plan.forceStepped,
              attachmentsAllowed: true,
              drawOrderAllowed: true,
              propertyAlpha: undefined,
              propertyAlphaScratch,
              propertyAlphaCallback: (propertyId, alpha) =>
                mixedPropertyAlphaV1(propertyAlphaScratch, propertyId, alpha),
            };
            this.#layerPool.push(reusable);
            sampledLayer = reusable;
          } else {
            sampledLayer = {
              animation: entry.animation,
              sampleTime,
              alpha: baseAlpha,
              blend: entry.blend,
              forceStepped: plan.forceStepped,
              attachmentsAllowed: true,
              drawOrderAllowed: true,
              propertyAlpha: undefined,
            };
          }
        }
        sampledLayer.animation = entry.animation;
        sampledLayer.sampleTime = sampleTime;
        sampledLayer.alpha = baseAlpha;
        sampledLayer.blend = entry.blend;
        sampledLayer.forceStepped = plan.forceStepped;
        sampledLayer.attachmentsAllowed = controller === undefined || controllerProgress < entry.attachmentThreshold;
        sampledLayer.drawOrderAllowed = controller === undefined || controllerProgress < entry.drawOrderThreshold;
        if (controller === undefined) {
          sampledLayer.propertyAlpha = undefined;
        } else if (reuseOutput) {
          const reusable = sampledLayer as ReusableAnimationLayerV1;
          const propertyAlphaScratch = reusable.propertyAlphaScratch;
          syncSetV1(propertyAlphaScratch.lowerOwned, lowerOwned);
          propertyAlphaScratch.controllerOwned = controllerOwned;
          propertyAlphaScratch.controllerProgress = controllerProgress;
          propertyAlphaScratch.holdPrevious = controller.holdPrevious;
          sampledLayer.propertyAlpha = reusable.propertyAlphaCallback;
        } else {
          sampledLayer.propertyAlpha = (propertyId, alpha) => {
            if (controller.holdPrevious) return alpha;
            if (propertySetOwns(controllerOwned, propertyId)
              && !propertySetOwns(strictLowerOwnedSnapshot, propertyId)) return alpha;
            return f32Mul(alpha, f32(1 - controllerProgress));
          };
        }
        layers[layerCount] = sampledLayer;
        layerCount += 1;
      }
      if (needsOwnership) {
        for (const entry of chain) {
          if (entry.animation !== null) {
            for (const property of ownedProperties(entry.animation)) lowerOwned.add(property);
          }
        }
      }
    }
    layers.length = layerCount;
    return layers;
  }

  #advanceTrack(
    trackIndex: number,
    track: TrackV1,
    delta: number,
    collector: EventCollectorV1,
  ): void {
    let remaining = delta;
    let wallBase = 0;
    let promotions = 0;
    while (track.current !== null) {
      const queued = track.queue[0];
      const current = track.current;
      let boundary: number | null = null;
      let boundaryKind: "promote" | "end" | null = null;
      const promotion = queued === undefined ? null : secondsUntilTrackTimeV1(current, queued.delay);
      const end = secondsUntilTrackTimeV1(current, current.trackEnd);
      if (promotion !== null && (end === null || promotion <= end)) {
        if (promotion <= remaining) {
          boundary = Math.max(0, promotion);
          boundaryKind = "promote";
        }
      } else if (end !== null && end <= remaining) {
        boundary = Math.max(0, end);
        boundaryKind = "end";
      }
      if (boundary === null) {
        this.#advanceEntryTree(current, remaining, wallBase, trackIndex, collector, null);
        break;
      }
      if (boundary > 0) {
        this.#advanceEntryTree(current, f32(boundary), wallBase, trackIndex, collector, null);
        remaining = f32(Math.max(0, remaining - boundary));
        wallBase += boundary;
      }
      if (boundaryKind === "promote") this.#promoteQueue(trackIndex, track, collector, wallBase);
      else this.#endTrack(trackIndex, track, collector, wallBase);
      promotions += 1;
      if (promotions > MAX_EVENTS_PER_OPERATION) {
        throw new RuntimeErrorV1("resourceLimit", "update", "Queue promotion limit exceeded.");
      }
      if (remaining === 0 && track.current !== null) {
        const next = track.queue[0];
        const immediatePromotion = next !== undefined && next.delay <= track.current.trackTime;
        const immediateEnd = track.current.trackEnd <= track.current.trackTime;
        if (!immediatePromotion && !immediateEnd) break;
      }
    }
  }

  #advanceEntryTree(
    entry: TrackEntryV1,
    delta: number,
    wallBase: number,
    trackIndex: number,
    collector: EventCollectorV1,
    controller: OutgoingControllerV1 | null,
  ): void {
    const mixStart = entry.mixTime;
    let outgoingDelta = delta;
    let completionOffset: number | null = null;
    const hadMixingFrom = entry.mixingFrom !== null;
    if (entry.mixingFrom !== null) {
      const remainingMix = Math.max(0, entry.mixDuration - mixStart);
      outgoingDelta = Math.min(delta, remainingMix);
      completionOffset = remainingMix <= delta ? remainingMix : null;
      if (outgoingDelta > 0 || remainingMix === 0) {
        this.#advanceEntryTree(
          entry.mixingFrom,
          f32(outgoingDelta),
          wallBase,
          trackIndex,
          collector,
          { entry, mixTimeAtStart: mixStart },
        );
      }
    }

    if (entry.mixingFrom !== null && completionOffset !== null) {
      const removed = entry.mixingFrom;
      entry.mixingFrom = null;
      const lifecycleEvents: RuntimeEventV1[] = [];
      disposeStartedChain(removed, trackIndex, lifecycleEvents);
      for (const event of lifecycleEvents) collector.push(event, wallBase + completionOffset, trackIndex);
    }

    const rawStart = entry.trackTime;
    const scaledDelta = f32Mul(delta, entry.timeScale);
    const rawEnd = entry.looping ? f32Add(rawStart, scaledDelta) : f32(Math.max(0, f32Add(rawStart, scaledDelta)));
    collectCrossings(entry, rawStart, rawEnd, delta, wallBase, trackIndex, collector, controller);
    entry.trackTime = rawEnd;
    if (hadMixingFrom) entry.mixTime = f32(Math.max(0, f32Add(entry.mixTime, delta)));
  }

  #promoteQueue(trackIndex: number, track: TrackV1, collector: EventCollectorV1, wallOffset: number): void {
    const queued = track.queue.shift();
    const outgoing = track.current;
    if (queued === undefined || outgoing === null) return;
    collector.push(lifecycle(trackIndex, animationIdV1(outgoing), "interrupt"), wallOffset, trackIndex);
    const incoming = queued.animation === null
      ? createEmptyEntry(queued.mixDuration)
      : createEntry(queued.animation, queued.looping, queued.mixDuration);
    incoming.delay = queued.delay;
    if (queued.mixDuration === 0) {
      const lifecycleEvents: RuntimeEventV1[] = [];
      disposeStartedChain(outgoing, trackIndex, lifecycleEvents);
      for (const event of lifecycleEvents) collector.push(event, wallOffset, trackIndex);
    } else {
      incoming.mixingFrom = outgoing;
    }
    track.current = incoming;
    collector.push(lifecycle(trackIndex, animationIdV1(incoming), "start"), wallOffset, trackIndex);
  }

  #endTrack(trackIndex: number, track: TrackV1, collector: EventCollectorV1, wallOffset: number): void {
    if (track.current !== null) {
      const lifecycleEvents: RuntimeEventV1[] = [];
      disposeStartedChain(track.current, trackIndex, lifecycleEvents);
      for (const event of lifecycleEvents) collector.push(event, wallOffset, trackIndex);
      track.current = null;
    }
    for (const queued of track.queue) {
      collector.push(lifecycle(trackIndex, queued.animation?.id ?? null, "dispose"), wallOffset, trackIndex);
    }
    track.queue.length = 0;
  }

  #track(index: number): TrackV1 {
    let track = this.#tracks.get(index);
    if (track === undefined) {
      track = { current: null, queue: [] };
      this.#tracks.set(index, track);
    }
    return track;
  }

  #requireCurrent(index: number, operation: string): TrackEntryV1 {
    const entry = this.#tracks.get(index)?.current;
    if (entry === undefined || entry === null) {
      throw new RuntimeErrorV1("invalidState", operation, `Track ${index} has no current animation.`, {
        field: "trackIndex",
      });
    }
    return entry;
  }

  #lookupAnimation(animationId: string, operation: string): RuntimeAnimationV1 {
    if (typeof animationId !== "string" || animationId.length === 0) invalid(operation, "animationId", "animationId must be non-empty.");
    try {
      return this.#data.animation(animationId);
    } catch (error) {
      if (error instanceof RuntimeErrorV1) {
        throw new RuntimeErrorV1("notFound", operation, `Unknown animation '${animationId}'.`, {
          field: "animationId",
          entityId: animationId,
        });
      }
      throw error;
    }
  }

  #mixDuration(from: string, to: string): number {
    return this.#pairMixes.get(pairKey(from, to)) ?? this.#defaultMix;
  }

  #setPairMix(key: string, duration: number): void {
    if (!this.#pairMixes.has(key)) this.#pairMixKeys.push(key);
    this.#pairMixes.set(key, duration);
  }

  #sortedTrackIndices(): readonly number[] {
    if (this.#sortedTrackIndicesCache.length !== this.#tracks.size) {
      this.#sortedTrackIndicesCache.length = 0;
      for (const trackIndex of this.#tracks.keys()) this.#sortedTrackIndicesCache.push(trackIndex);
      this.#sortedTrackIndicesCache.sort((left, right) => left - right);
    }
    return this.#sortedTrackIndicesCache;
  }
}

function mixedPropertyAlphaV1(
  scratch: RuntimePropertyAlphaScratchV1,
  propertyId: string,
  alpha: number,
): number {
  if (scratch.holdPrevious) return alpha;
  if (propertySetOwns(scratch.controllerOwned, propertyId)
    && !propertySetOwns(scratch.lowerOwned, propertyId)) return alpha;
  return f32Mul(alpha, f32(1 - scratch.controllerProgress));
}

function syncSetV1(target: Set<string>, source: ReadonlySet<string>): void {
  let matches = target.size === source.size;
  if (matches) {
    for (const value of source) {
      if (!target.has(value)) {
        matches = false;
        break;
      }
    }
  }
  if (matches) return;
  target.clear();
  for (const value of source) target.add(value);
}

export function samplingPlanV1(sampling: RuntimeSamplingV1): RuntimeSamplingPlanV1 {
  if (sampling === null || typeof sampling !== "object") invalid("apply", "sampling", "sampling must be an object.");
  if (sampling.mode === "authored") return AUTHORED_PLAN_V1;
  if (sampling.mode === "forceStepped") return FORCE_STEPPED_PLAN_V1;
  if (sampling.mode === "fixedFrame" || sampling.mode === "fixedFrameStepped") {
    const cached = FIXED_SAMPLING_PLAN_CACHE.get(sampling);
    if (cached !== undefined) return cached;
    const created: RuntimeSamplingPlanV1 = {
      forceStepped: sampling.mode === "fixedFrameStepped",
      frameStepSeconds: positive(sampling.frameStepSeconds, "apply", "frameStepSeconds"),
    };
    FIXED_SAMPLING_PLAN_CACHE.set(sampling, created);
    return created;
  }
  invalid("apply", "sampling.mode", "Unknown sampling mode.");
}

function createEntry(animation: RuntimeAnimationV1, looping: boolean, mixDuration: number): TrackEntryV1 {
  return {
    animation,
    animationStart: 0,
    animationEnd: animation.duration,
    trackTime: 0,
    delay: 0,
    trackEnd: F32_MAX,
    timeScale: 1,
    looping,
    alpha: 1,
    blend: "replace",
    mixDuration,
    mixTime: 0,
    eventThreshold: 0,
    attachmentThreshold: 0,
    drawOrderThreshold: 0,
    holdPrevious: false,
    eventCursorInitialized: false,
    mixingFrom: null,
  };
}

function createEmptyEntry(mixDuration: number): TrackEntryV1 {
  return {
    animation: null,
    animationStart: 0,
    animationEnd: 0,
    trackTime: 0,
    delay: 0,
    trackEnd: mixDuration,
    timeScale: 1,
    looping: false,
    alpha: 1,
    blend: "replace",
    mixDuration,
    mixTime: 0,
    eventThreshold: 0,
    attachmentThreshold: 0,
    drawOrderThreshold: 0,
    holdPrevious: false,
    eventCursorInitialized: true,
    mixingFrom: null,
  };
}

function cloneEntry(entry: TrackEntryV1 | null): TrackEntryV1 | null {
  if (entry === null) return null;
  return { ...entry, mixingFrom: cloneEntry(entry.mixingFrom) };
}

function copyEntryIntoV1(target: TrackEntryV1 | null, source: TrackEntryV1 | null): TrackEntryV1 | null {
  if (source === null) return null;
  const output = target ?? createEmptyEntry(0);
  output.animation = source.animation;
  output.animationStart = source.animationStart;
  output.animationEnd = source.animationEnd;
  output.trackTime = source.trackTime;
  output.delay = source.delay;
  output.trackEnd = source.trackEnd;
  output.timeScale = source.timeScale;
  output.looping = source.looping;
  output.alpha = source.alpha;
  output.blend = source.blend;
  output.mixDuration = source.mixDuration;
  output.mixTime = source.mixTime;
  output.eventThreshold = source.eventThreshold;
  output.attachmentThreshold = source.attachmentThreshold;
  output.drawOrderThreshold = source.drawOrderThreshold;
  output.holdPrevious = source.holdPrevious;
  output.eventCursorInitialized = source.eventCursorInitialized;
  output.mixingFrom = copyEntryIntoV1(output.mixingFrom, source.mixingFrom);
  return output;
}

function reconcileEntryV1(entry: TrackEntryV1 | null, data: RuntimeDataV1): TrackEntryV1 | null {
  if (entry === null) return null;
  const next = cloneEntry(entry);
  if (next === null) return null;
  if (next.animation !== null) {
    const animation = findAnimationV1(data, next.animation.id);
    if (animation === null) return null;
    const currentTime = poseTime(next);
    const usedFullRange = next.animationStart === 0 && next.animationEnd === next.animation.duration;
    next.animation = animation;
    const duration = Math.max(0, animation.duration);
    if (usedFullRange) {
      next.animationStart = 0;
      next.animationEnd = duration;
    } else {
      next.animationStart = Math.min(Math.max(next.animationStart, 0), duration);
      next.animationEnd = Math.min(Math.max(next.animationEnd, 0), duration);
      if (!(next.animationEnd > next.animationStart)) {
        next.animationStart = 0;
        next.animationEnd = duration;
      }
    }
    next.trackTime = f32(Math.max(0, Math.min(Math.max(currentTime, next.animationStart), next.animationEnd) - next.animationStart));
  }
  next.mixingFrom = reconcileEntryV1(next.mixingFrom, data);
  return next;
}

function flattenChainInto(entry: TrackEntryV1, result: TrackEntryV1[]): TrackEntryV1[] {
  let count = 0;
  let current: TrackEntryV1 | null = entry;
  while (current !== null) {
    result[count] = current;
    count += 1;
    current = current.mixingFrom;
  }
  result.length = count;
  result.reverse();
  return result;
}

function mixProgress(entry: TrackEntryV1): number {
  if (entry.mixingFrom === null) return 1;
  if (entry.mixDuration === 0) return 1;
  return f32(Math.min(Math.max(entry.mixTime / entry.mixDuration, 0), 1));
}

function animationIdV1(entry: TrackEntryV1): string | null {
  return entry.animation?.id ?? null;
}

function entryRangeDurationV1(entry: TrackEntryV1): number {
  return f32(Math.max(0, entry.animationEnd - entry.animationStart));
}

function queuedRangeDurationV1(entry: QueuedEntryV1): number {
  return entry.animation?.duration ?? 0;
}

function secondsUntilTrackTimeV1(entry: TrackEntryV1, targetTrackTime: number): number | null {
  const remaining = targetTrackTime - entry.trackTime;
  if (remaining <= 0) return 0;
  if (!(entry.timeScale > 0)) return null;
  const seconds = remaining / entry.timeScale;
  return Number.isFinite(seconds) ? seconds : null;
}

function poseTime(entry: TrackEntryV1): number {
  const duration = entryRangeDurationV1(entry);
  if (duration === 0) return entry.animationStart;
  const local = entry.looping
    ? ((entry.trackTime % duration) + duration) % duration
    : Math.min(Math.max(entry.trackTime, 0), duration);
  return f32Add(entry.animationStart, local);
}

function collectCrossings(
  entry: TrackEntryV1,
  rawStart: number,
  rawEnd: number,
  wallDelta: number,
  wallBase: number,
  trackIndex: number,
  collector: EventCollectorV1,
  controller: OutgoingControllerV1 | null,
): void {
  const animation = entry.animation;
  if (animation === null) return;
  if (rawStart === rawEnd || wallDelta === 0) return;
  const forward = rawEnd > rawStart;
  if (!entry.eventCursorInitialized) {
    entry.eventCursorInitialized = true;
    for (const key of animation.events) {
      if (key.time < entry.animationStart) continue;
      if (key.time !== entry.animationStart) break;
      pushUserEvent(entry, key, wallBase, trackIndex, collector, controller, 0, wallDelta);
    }
  }
  const duration = entryRangeDurationV1(entry);
  if (duration === 0) return;
  if (entry.looping) collectLoopingCrossings(entry, rawStart, rawEnd, wallDelta, wallBase, trackIndex, collector, controller, forward);
  else collectNonLoopingCrossings(entry, rawStart, rawEnd, wallDelta, wallBase, trackIndex, collector, controller, forward);
}

interface CrossingCandidateV1 {
  readonly raw: number;
  readonly phase: number;
  readonly declaration: number;
  readonly event: RuntimeEventKeyV1 | null;
}

function compareForwardCrossingV1(left: CrossingCandidateV1, right: CrossingCandidateV1): number {
  const rawOrder = left.raw - right.raw;
  if (rawOrder !== 0) return rawOrder;
  if (left.phase !== right.phase) return left.phase - right.phase;
  return left.declaration - right.declaration;
}

function compareReverseCrossingV1(left: CrossingCandidateV1, right: CrossingCandidateV1): number {
  const rawOrder = right.raw - left.raw;
  if (rawOrder !== 0) return rawOrder;
  if (left.phase !== right.phase) return left.phase - right.phase;
  return right.declaration - left.declaration;
}

function collectLoopingCrossings(
  entry: TrackEntryV1,
  rawStart: number,
  rawEnd: number,
  wallDelta: number,
  wallBase: number,
  trackIndex: number,
  collector: EventCollectorV1,
  controller: OutgoingControllerV1 | null,
  forward: boolean,
): void {
  const animation = entry.animation;
  if (animation === null) return;
  const duration = entryRangeDurationV1(entry);
  const minimum = Math.min(rawStart, rawEnd);
  const maximum = Math.max(rawStart, rawEnd);
  const firstCycle = Math.floor(minimum / duration) - 1;
  const lastCycle = Math.floor(maximum / duration) + 1;
  const boundaryCount = Math.max(0, lastCycle - firstCycle + 1);
  if (boundaryCount > collector.capacity + 4
    || boundaryCount * (animation.events.length + 1) > collector.capacity + 4) {
    throw new RuntimeErrorV1("resourceLimit", "update", "Event boundary limit exceeded.");
  }
  const candidates = collector.crossingCandidates();
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const cycleStart = cycle * duration;
    const boundary = cycleStart;
    if (ownsRawCrossing(boundary, rawStart, rawEnd, forward)) {
      candidates.push({ raw: boundary, phase: 1, declaration: 0, event: null });
    }
    for (let declaration = 0; declaration < animation.events.length; declaration += 1) {
      const key = animation.events[declaration];
      if (key === undefined) continue;
      if (key.time < entry.animationStart || key.time > entry.animationEnd) continue;
      const crossing = cycleStart + (key.time - entry.animationStart);
      if (!ownsRawCrossing(crossing, rawStart, rawEnd, forward)) continue;
      const atZero = key.time === entry.animationStart;
      const atEnd = key.time === entry.animationEnd;
      const phase = forward ? atZero ? 2 : 0 : atEnd ? 2 : 0;
      candidates.push({ raw: crossing, phase, declaration, event: key });
    }
  }
  if (candidates.length > 1) candidates.sort(forward ? compareForwardCrossingV1 : compareReverseCrossingV1);
  emitCandidates(entry, candidates, rawStart, rawEnd, wallDelta, wallBase, trackIndex, collector, controller);
}

function collectNonLoopingCrossings(
  entry: TrackEntryV1,
  rawStart: number,
  rawEnd: number,
  wallDelta: number,
  wallBase: number,
  trackIndex: number,
  collector: EventCollectorV1,
  controller: OutgoingControllerV1 | null,
  forward: boolean,
): void {
  const animation = entry.animation;
  if (animation === null) return;
  const candidates = collector.crossingCandidates();
  for (let declaration = 0; declaration < animation.events.length; declaration += 1) {
    const key = animation.events[declaration];
    if (key !== undefined && key.time >= entry.animationStart && key.time <= entry.animationEnd) {
      const crossing = key.time - entry.animationStart;
      if (ownsRawCrossing(crossing, rawStart, rawEnd, forward)) {
        candidates.push({ raw: crossing, phase: 0, declaration, event: key });
      }
    }
  }
  const duration = entryRangeDurationV1(entry);
  if (forward && rawStart < duration && rawEnd >= duration) {
    candidates.push({ raw: duration, phase: 1, declaration: 0, event: null });
  } else if (!forward && rawStart > 0 && rawEnd <= 0) {
    candidates.push({ raw: 0, phase: 1, declaration: 0, event: null });
  }
  if (candidates.length > 1) candidates.sort(forward ? compareForwardCrossingV1 : compareReverseCrossingV1);
  emitCandidates(entry, candidates, rawStart, rawEnd, wallDelta, wallBase, trackIndex, collector, controller);
}

function emitCandidates(
  entry: TrackEntryV1,
  candidates: readonly CrossingCandidateV1[],
  rawStart: number,
  rawEnd: number,
  wallDelta: number,
  wallBase: number,
  trackIndex: number,
  collector: EventCollectorV1,
  controller: OutgoingControllerV1 | null,
): void {
  const animation = entry.animation;
  if (animation === null) return;
  for (const candidate of candidates) {
    const wallOffset = wallBase + ((candidate.raw - rawStart) / (rawEnd - rawStart)) * wallDelta;
    if (candidate.event === null) {
      collector.push(lifecycle(trackIndex, animation.id, "complete"), wallOffset, trackIndex);
    } else {
      pushUserEvent(entry, candidate.event, wallOffset, trackIndex, collector, controller, wallOffset - wallBase, wallDelta);
    }
  }
}

function pushUserEvent(
  entry: TrackEntryV1,
  key: RuntimeEventKeyV1,
  wallOffset: number,
  trackIndex: number,
  collector: EventCollectorV1,
  controller: OutgoingControllerV1 | null,
  localWallOffset: number,
  segmentDelta: number,
): void {
  const animation = entry.animation;
  if (animation === null) return;
  if (controller !== null) {
    const crossingMixTime = controller.mixTimeAtStart + (segmentDelta === 0 ? 0 : localWallOffset);
    const progress = controller.entry.mixDuration === 0
      ? 1
      : Math.min(Math.max(crossingMixTime / controller.entry.mixDuration, 0), 1);
    if (!(progress < entry.eventThreshold)) return;
  }
  collector.push({
    trackIndex,
    animationId: animation.id,
    kind: "user",
    timelineTimeSeconds: key.time,
    eventId: key.eventId,
    name: key.name,
    integerValue: key.integerValue,
    stringValue: key.stringValue,
    numberValue: key.numberValue,
    audioId: key.audioId,
    volume: key.volume,
    balance: key.balance,
  }, wallOffset, trackIndex);
}

function ownsRawCrossing(crossing: number, start: number, end: number, forward: boolean): boolean {
  return forward ? crossing > start && crossing <= end : crossing >= end && crossing < start;
}

function comparePendingEventV1(left: PendingEventV1, right: PendingEventV1): number {
  return left.wallOffset - right.wallOffset || left.trackIndex - right.trackIndex || left.ordinal - right.ordinal;
}

class EventCollectorV1 {
  readonly #events: PendingEventV1[] = [];
  readonly #output: RuntimeEventV1[] = [];
  readonly #crossingCandidates: CrossingCandidateV1[] = [];
  #limit: number;
  #ordinal = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  reset(limit: number): EventCollectorV1 {
    this.#events.length = 0;
    this.#output.length = 0;
    this.#crossingCandidates.length = 0;
    this.#limit = limit;
    this.#ordinal = 0;
    return this;
  }

  get capacity(): number {
    return this.#limit;
  }

  crossingCandidates(): CrossingCandidateV1[] {
    this.#crossingCandidates.length = 0;
    return this.#crossingCandidates;
  }

  push(event: RuntimeEventV1, wallOffset: number, trackIndex: number): void {
    if (this.#events.length >= this.#limit) {
      throw new RuntimeErrorV1("resourceLimit", "update", "One operation would emit more than 1,000,000 events.");
    }
    this.#events.push({ wallOffset, trackIndex, ordinal: this.#ordinal, event });
    this.#ordinal += 1;
  }

  finish(reuseOutput = false): RuntimeEventV1[] {
    if (this.#events.length > 1) this.#events.sort(comparePendingEventV1);
    if (!reuseOutput) return this.#events.map((item) => item.event);
    this.#output.length = this.#events.length;
    for (let index = 0; index < this.#events.length; index += 1) {
      const item = this.#events[index];
      if (item !== undefined) this.#output[index] = item.event;
    }
    return this.#output;
  }
}

function lifecycle(
  trackIndex: number,
  animationId: string | null,
  kind: "start" | "interrupt" | "end" | "dispose" | "complete",
): RuntimeEventV1 {
  return {
    trackIndex,
    animationId,
    kind,
    timelineTimeSeconds: null,
    eventId: null,
    name: null,
    integerValue: null,
    stringValue: null,
    numberValue: null,
    audioId: null,
    volume: 1,
    balance: 0,
  };
}

function disposeStartedChain(entry: TrackEntryV1, trackIndex: number, events: RuntimeEventV1[]): void {
  events.push(lifecycle(trackIndex, animationIdV1(entry), "end"));
  events.push(lifecycle(trackIndex, animationIdV1(entry), "dispose"));
  if (entry.mixingFrom !== null) disposeStartedChain(entry.mixingFrom, trackIndex, events);
}

const PROPERTY_CACHE = new WeakMap<RuntimeAnimationV1, ReadonlySet<string>>();

function ownedProperties(animation: RuntimeAnimationV1): ReadonlySet<string> {
  const cached = PROPERTY_CACHE.get(animation);
  if (cached !== undefined) return cached;
  const result = new Set<string>();
  for (const timeline of animation.boneTimelines) {
    if (hasTimelineKeysV1(timeline.translate) || hasTimelineKeysV1(timeline.translateX)) result.add(`bone:${timeline.boneId}:x`);
    if (hasTimelineKeysV1(timeline.translate) || hasTimelineKeysV1(timeline.translateY)) result.add(`bone:${timeline.boneId}:y`);
    if (hasTimelineKeysV1(timeline.rotate)) result.add(`bone:${timeline.boneId}:rotation`);
    if (hasTimelineKeysV1(timeline.scale) || hasTimelineKeysV1(timeline.scaleX)) result.add(`bone:${timeline.boneId}:scaleX`);
    if (hasTimelineKeysV1(timeline.scale) || hasTimelineKeysV1(timeline.scaleY)) result.add(`bone:${timeline.boneId}:scaleY`);
    if (hasTimelineKeysV1(timeline.shear) || hasTimelineKeysV1(timeline.shearX)) result.add(`bone:${timeline.boneId}:shearX`);
    if (hasTimelineKeysV1(timeline.shear) || hasTimelineKeysV1(timeline.shearY)) result.add(`bone:${timeline.boneId}:shearY`);
    if (hasTimelineKeysV1(timeline.inherit)) result.add(`bone:${timeline.boneId}:inherit`);
  }
  for (const timeline of animation.slotTimelines) {
    if (hasTimelineKeysV1(timeline.attachment)) result.add(`slot:${timeline.slotId}:attachment`);
    if (hasTimelineKeysV1(timeline.color)) {
      for (const property of ["color_r", "color_g", "color_b", "dark_r", "dark_g", "dark_b"]) {
        result.add(`slot:${timeline.slotId}:${property}`);
      }
    }
    if (hasTimelineKeysV1(timeline.alpha) || hasTimelineKeysV1(timeline.color)) result.add(`slot:${timeline.slotId}:alpha`);
  }
  for (const timeline of animation.attachmentTimelines) {
    if (hasTimelineKeysV1(timeline.region)) {
      for (const property of ["x", "y", "rotation", "scaleX", "scaleY"]) {
        result.add(`attachment:${timeline.attachmentId}:${property}`);
      }
    }
    if (hasTimelineKeysV1(timeline.deform)) result.add(`attachment:${timeline.attachmentId}:deform`);
    if (hasTimelineKeysV1(timeline.sequence)) result.add(`attachment:${timeline.attachmentId}:sequence`);
  }
  for (const timeline of animation.constraintTimelines) {
    const fields = timeline.type === "ik"
      ? ["targetX", "targetY", "mix", "bendPositive", "compress", "stretch", "softness"]
      : timeline.type === "transform"
        ? ["mixRotate", "mixX", "mixY", "mixScaleX", "mixScaleY", "mixShearY"]
        : timeline.type === "path"
          ? ["position", "spacing", "mixRotate", "mixX", "mixY"]
          : timeline.type === "physics"
            ? ["mix", "inertia", "strength", "damping", "mass", "wind", "gravity"]
            : ["sliderTime", "mix"];
    for (const field of fields) {
      if (timeline.keys.some((key) => {
        const value = (key as unknown as Record<string, unknown>)[field];
        return value !== null && value !== undefined;
      })) {
        result.add(`constraint:${timeline.constraintId}:${field}`);
      }
    }
  }
  if (animation.drawOrder.length > 0 || animation.drawOrderFolders.length > 0) {
    result.add("draw-order");
  }
  if (animation.skins.length > 0) result.add("skin");
  PROPERTY_CACHE.set(animation, result);
  return result;
}

function hasTimelineKeysV1(value: readonly unknown[] | null): boolean {
  return value !== null && value.length > 0;
}

function propertySetOwns(properties: ReadonlySet<string> | null, propertyId: string): boolean {
  if (properties === null) return false;
  if (properties.has(propertyId)) return true;
  if (!propertyId.startsWith("constraint:")) return false;
  const separator = propertyId.lastIndexOf(":");
  return separator >= 0 && properties.has(`constraint:*:${propertyId.slice(separator + 1)}`);
}

function pairKey(from: string, to: string): string {
  return `${from.length}:${from}${to}`;
}

function parsePairKeyV1(key: string): readonly [string, string] {
  const separator = key.indexOf(":");
  const length = Number(key.slice(0, separator));
  const start = separator + 1;
  return [key.slice(start, start + length), key.slice(start + length)];
}

function findAnimationV1(data: RuntimeDataV1, animationId: string): RuntimeAnimationV1 | null {
  return data.document.animations.find((animation) => animation.id === animationId) ?? null;
}

function hasAnimationV1(data: RuntimeDataV1, animationId: string): boolean {
  return findAnimationV1(data, animationId) !== null;
}

function validateTrackIndex(value: number, operation: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TRACK_INDEX) {
    invalid(operation, "trackIndex", `trackIndex must be an integer in [0,${MAX_TRACK_INDEX}].`);
  }
  return value;
}

function validateQueueIndex(value: number, operation: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    invalid(operation, "queueIndex", "queueIndex must be a u32.");
  }
  return value;
}

function queuedNotFound(operation: string, queueIndex: number): never {
  throw new RuntimeErrorV1("notFound", operation, `No queued entry exists at index ${queueIndex}.`, {
    field: "queueIndex",
  });
}

function finite(value: number, operation: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RuntimeErrorV1("nonFinite", operation, `${field} must be finite.`, { field });
  }
  try {
    return finiteF32(value);
  } catch (error) {
    throw new RuntimeErrorV1("nonFinite", operation, `${field} is outside binary32 range.`, { field, cause: error });
  }
}

function nonNegative(value: number, operation: string, field: string): number {
  const result = finite(value, operation, field);
  if (result < 0) invalid(operation, field, `${field} must be non-negative.`);
  return result;
}

function positive(value: number, operation: string, field: string): number {
  const result = finite(value, operation, field);
  if (result <= 0) invalid(operation, field, `${field} must be positive.`);
  return result;
}

function unit(value: number, operation: string, field: string): number {
  const result = finite(value, operation, field);
  if (result < 0 || result > 1) invalid(operation, field, `${field} must be in [0,1].`);
  return result;
}

function invalid(operation: string, field: string, message: string): never {
  throw new RuntimeErrorV1("invalidArgument", operation, message, { field });
}
