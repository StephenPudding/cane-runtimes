import { System, SystemPriority, director } from "cc";
import type { CaneSkeleton } from "./skeleton.js";

/** One Cocos system updates every Cane component; no per-character engine listener is registered. */
export class CaneSkeletonSystem extends System {
  static readonly ID = "CANE_SKELETON";
  static #instance: CaneSkeletonSystem | null = null;

  readonly #skeletons = new Set<CaneSkeleton>();

  private constructor() { super(); }

  static getInstance(): CaneSkeletonSystem {
    let instance = CaneSkeletonSystem.#instance;
    if (instance === null) {
      instance = new CaneSkeletonSystem();
      director.registerSystem(CaneSkeletonSystem.ID, instance, SystemPriority.HIGH);
      CaneSkeletonSystem.#instance = instance;
    }
    return instance;
  }

  get size(): number { return this.#skeletons.size; }

  add(skeleton: CaneSkeleton | null): void {
    if (skeleton !== null) this.#skeletons.add(skeleton);
  }

  remove(skeleton: CaneSkeleton | null): void {
    if (skeleton !== null) this.#skeletons.delete(skeleton);
  }

  postUpdate(deltaSeconds: number): void {
    for (const skeleton of this.#skeletons) {
      if (!skeleton.isValid) {
        this.#skeletons.delete(skeleton);
        continue;
      }
      skeleton.updateAnimation(deltaSeconds);
    }
  }

  /** Called by integrations that explicitly stage render preparation before the UI walk. */
  prepareRenderData(): void {
    for (const skeleton of this.#skeletons) {
      if (skeleton.isValid) skeleton.prepareCaneRenderData();
    }
  }
}
