import {
  ConeGeometry, DynamicDrawUsage, Group, InstancedInterleavedBuffer,
  InterleavedBufferAttribute, Mesh, MeshBasicMaterial, Vector3,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export interface SpatialLinkAppearance {
  color: string;
  width: number;
  style: "solid" | "dashed" | "dotted";
  opacity: number;
  showArrow: boolean;
  arrowLength: number;
  targetRadius: number;
}

export interface SpatialPosition3D { x: number; y: number; z?: number }

interface SpatialCurve {
  getPoint(t: number, target?: Vector3): Vector3;
  v0?: SpatialPosition3D;
  v1?: SpatialPosition3D;
  v2?: SpatialPosition3D;
  v3?: SpatialPosition3D;
}

const SEGMENTS = 48;
const EPSILON = 1e-8;
const finite = (value: number | undefined): number => Number.isFinite(value) ? value! : 0;

/**
 * A link owns its path, arrow, materials and buffers. These are mutable scene
 * resources; no coordinates or appearance are written back to authored data.
 */
export class SpatialLink3D {
  readonly group = new Group();
  private readonly geometry = new LineGeometry();
  private readonly material = new LineMaterial({
    worldUnits: true, transparent: true, depthWrite: false, alphaToCoverage: false,
  });
  private readonly line = new Line2(this.geometry, this.material);
  private readonly arrowGeometry = new ConeGeometry(1, 1, 8);
  private readonly arrowMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  private readonly arrow = new Mesh(this.arrowGeometry, this.arrowMaterial);
  private readonly samples = new Float64Array((SEGMENTS + 1) * 3);
  private readonly cumulative = new Float64Array(SEGMENTS + 1);
  private readonly shape = new Float64Array(18);
  private readonly nextShape = new Float64Array(18);
  private readonly distanceBuffer = new InstancedInterleavedBuffer(new Float32Array(SEGMENTS * 2), 2, 1);
  private readonly positionBuffer: InstancedInterleavedBuffer;
  private readonly point = new Vector3();
  private readonly arrowTail = new Vector3();
  private readonly arrowHead = new Vector3();
  private readonly direction = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly dottedUniform = { value: 0 };
  private appearance!: SpatialLinkAppearance;
  private hasPosition = false;
  private curveKind = -1;
  private totalLength = 0;
  private disposed = false;
  private geometryDisposed = false;
  private materialDisposed = false;
  private arrowGeometryDisposed = false;
  private arrowMaterialDisposed = false;

  constructor(appearance: SpatialLinkAppearance) {
    this.group.name = "gps-spatial-link";
    this.line.name = "gps-spatial-link-path";
    this.arrow.name = "gps-spatial-link-arrow";
    // Fixed buffers are installed once. Recomputing line distances or calling
    // setPositions during a tick would allocate new arrays and GPU attributes.
    this.geometry.setPositions(new Float32Array((SEGMENTS + 1) * 3));
    this.positionBuffer = (this.geometry.getAttribute("instanceStart") as InterleavedBufferAttribute).data as InstancedInterleavedBuffer;
    this.positionBuffer.setUsage(DynamicDrawUsage);
    this.distanceBuffer.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute("instanceDistanceStart", new InterleavedBufferAttribute(this.distanceBuffer, 1, 0));
    this.geometry.setAttribute("instanceDistanceEnd", new InterleavedBufferAttribute(this.distanceBuffer, 1, 1));
    this.installRoundedDots();
    // Cone base at zero, tip at +Y; its transform follows the actual 3D path.
    this.arrowGeometry.translate(0, 0.5, 0);
    this.group.add(this.line, this.arrow);
    // Three's Raycaster also visits invisible objects. A hidden relationship
    // must not leave hover targets or tooltips behind when its opacity is zero.
    const lineRaycast = this.line.raycast.bind(this.line);
    this.line.raycast = (raycaster, intersects) => {
      if (this.group.visible && this.line.visible) lineRaycast(raycaster, intersects);
    };
    const arrowRaycast = this.arrow.raycast.bind(this.arrow);
    this.arrow.raycast = (raycaster, intersects) => {
      if (this.group.visible && this.arrow.visible) arrowRaycast(raycaster, intersects);
    };
    // The force-graph digest also disposes removed custom-object children.
    // Track those events so our explicit teardown never disposes them twice.
    this.geometry.addEventListener("dispose", () => { this.geometryDisposed = true; });
    this.material.addEventListener("dispose", () => { this.materialDisposed = true; });
    this.arrowGeometry.addEventListener("dispose", () => { this.arrowGeometryDisposed = true; });
    this.arrowMaterial.addEventListener("dispose", () => { this.arrowMaterialDisposed = true; });
    this.updateAppearance(appearance);
  }

  private installRoundedDots(): void {
    const opacityAnchor = "uniform float opacity;";
    const radialAnchor = "float norm = len / linewidth;";
    const source = this.material.fragmentShader;
    if (!source.includes(opacityAnchor) || !source.includes(radialAnchor)
      || !source.includes("if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard;")) {
      throw new Error("Graph Plus Semantic: installed Three.js LineMaterial shader does not support rounded spatial dots");
    }
    this.material.uniforms.gpsDotted = this.dottedUniform;
    this.material.fragmentShader = source
      .replace(opacityAnchor, `${opacityAnchor}\n uniform float gpsDotted;`)
      .replace(radialAnchor, `${radialAnchor}
        #ifdef USE_DASH
          if (gpsDotted > 0.5) {
            float gpsAlong = mod(vLineDistance + dashOffset, dashSize + gapSize) - dashSize * 0.5;
            float gpsLongitudinal = gpsAlong / linewidth;
            if (norm * norm + gpsLongitudinal * gpsLongitudinal > 0.25) discard;
          } else if (norm > 0.5) {
            discard;
          }
        #endif`);
  }

  updateAppearance(appearance: SpatialLinkAppearance): void {
    if (this.disposed) return;
    const width = Math.max(0.1, finite(appearance.width));
    const opacity = Math.min(1, Math.max(0, finite(appearance.opacity)));
    const previous = this.appearance;
    if (previous && previous.color === appearance.color && previous.width === width
      && previous.style === appearance.style && previous.opacity === opacity
      && previous.showArrow === appearance.showArrow && previous.arrowLength === appearance.arrowLength
      && previous.targetRadius === appearance.targetRadius) return;
    this.appearance = { ...appearance, width, opacity };
    this.material.color.set(appearance.color);
    this.arrowMaterial.color.set(appearance.color);
    this.material.linewidth = width;
    this.material.opacity = opacity;
    this.arrowMaterial.opacity = opacity;
    this.material.dashed = appearance.style !== "solid";
    this.dottedUniform.value = appearance.style === "dotted" ? 1 : 0;
    this.material.dashSize = appearance.style === "dotted" ? width : Math.max(1.5, width * 5);
    this.material.gapSize = appearance.style === "dotted" ? width * 2 : Math.max(1, width * 3);
    this.group.visible = opacity > 0;
    this.group.userData.lineStyle = appearance.style;
    this.group.userData.width = width;
    this.group.userData.opacity = opacity;
    this.updateArrow();
  }

  /** The installed force-graph computes its curve before this callback. */
  updatePosition(start: SpatialPosition3D, end: SpatialPosition3D, link: { __curve?: SpatialCurve | null }): void {
    if (this.disposed) return;
    const candidate = link.__curve;
    const curve = candidate && typeof candidate.getPoint === "function" ? candidate : null;
    const knownCurve = !!(curve?.v0 && curve.v1 && curve.v2);
    const kind = !curve ? 0 : knownCurve ? (curve!.v3 ? 3 : 2) : 1;
    this.writeShape(start, end, curve);
    let changed = !this.hasPosition || kind !== this.curveKind;
    // Known quadratic/cubic curves are recreated by the library each tick,
    // so compare their control coordinates rather than their object identity.
    if (!changed) {
      for (let index = 0; index < this.shape.length; index++) {
        if (this.shape[index] !== this.nextShape[index]) { changed = true; break; }
      }
    }
    // Unknown curve implementations may mutate without exposing controls.
    if (kind === 1) changed = true;
    if (!changed) return;
    this.shape.set(this.nextShape);
    this.curveKind = kind;
    this.hasPosition = true;

    let validCurve = !!curve;
    if (curve) {
      try {
        for (let index = 0; index <= SEGMENTS; index++) {
          const sample = curve.getPoint(index / SEGMENTS, this.point);
          if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.z)) {
            validCurve = false; break;
          }
          const offset = index * 3;
          this.samples[offset] = sample.x;
          this.samples[offset + 1] = sample.y;
          this.samples[offset + 2] = sample.z;
        }
      } catch {
        validCurve = false;
      }
    }
    if (!validCurve) {
      const sx = finite(start.x), sy = finite(start.y), sz = finite(start.z);
      const dx = finite(end.x) - sx, dy = finite(end.y) - sy, dz = finite(end.z) - sz;
      for (let index = 0; index <= SEGMENTS; index++) {
        const t = index / SEGMENTS, offset = index * 3;
        this.samples[offset] = sx + dx * t;
        this.samples[offset + 1] = sy + dy * t;
        this.samples[offset + 2] = sz + dz * t;
      }
    }
    const positions = this.positionBuffer.array;
    const distances = this.distanceBuffer.array;
    this.cumulative[0] = 0;
    let length = 0;
    for (let index = 0; index < SEGMENTS; index++) {
      const sample = index * 3, segment = index * 6;
      const dx = this.samples[sample + 3] - this.samples[sample];
      const dy = this.samples[sample + 4] - this.samples[sample + 1];
      const dz = this.samples[sample + 5] - this.samples[sample + 2];
      distances[index * 2] = length;
      length += Math.hypot(dx, dy, dz);
      distances[index * 2 + 1] = length;
      this.cumulative[index + 1] = length;
      for (let component = 0; component < 6; component++) positions[segment + component] = this.samples[sample + component];
    }
    this.totalLength = length;
    this.positionBuffer.needsUpdate = true;
    this.distanceBuffer.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.line.visible = length > EPSILON;
    this.updateArrow();
  }

  private writeShape(start: SpatialPosition3D, end: SpatialPosition3D, curve: SpatialCurve | null): void {
    const values = this.nextShape;
    values[0] = finite(start.x); values[1] = finite(start.y); values[2] = finite(start.z);
    values[3] = finite(end.x); values[4] = finite(end.y); values[5] = finite(end.z);
    this.writeControl(6, curve?.v0);
    this.writeControl(9, curve?.v1);
    this.writeControl(12, curve?.v2);
    this.writeControl(15, curve?.v3);
  }

  private writeControl(offset: number, point: SpatialPosition3D | undefined): void {
    this.nextShape[offset] = finite(point?.x);
    this.nextShape[offset + 1] = finite(point?.y);
    this.nextShape[offset + 2] = finite(point?.z);
  }

  private pointAtDistance(distance: number, target: Vector3): void {
    const clamped = Math.max(0, Math.min(this.totalLength, distance));
    let index = 0;
    while (index < SEGMENTS - 1 && this.cumulative[index + 1] < clamped) index++;
    const length = this.cumulative[index + 1] - this.cumulative[index];
    const t = length > EPSILON ? (clamped - this.cumulative[index]) / length : 0;
    const offset = index * 3;
    target.set(
      this.samples[offset] + (this.samples[offset + 3] - this.samples[offset]) * t,
      this.samples[offset + 1] + (this.samples[offset + 4] - this.samples[offset + 1]) * t,
      this.samples[offset + 2] + (this.samples[offset + 5] - this.samples[offset + 2]) * t,
    );
  }

  private updateArrow(): void {
    const appearance = this.appearance;
    this.arrow.visible = false;
    if (!appearance || !this.hasPosition || !appearance.showArrow || appearance.opacity <= 0) return;
    const headDistance = Math.max(0, this.totalLength - Math.max(0, finite(appearance.targetRadius)));
    const arrowLength = Math.min(Math.max(0, finite(appearance.arrowLength)), headDistance);
    if (arrowLength <= EPSILON) return;
    this.pointAtDistance(headDistance, this.arrowHead);
    this.pointAtDistance(headDistance - arrowLength, this.arrowTail);
    this.direction.subVectors(this.arrowHead, this.arrowTail);
    const chordLength = this.direction.length();
    if (chordLength <= EPSILON) return;
    this.arrow.position.copy(this.arrowTail);
    this.arrow.quaternion.setFromUnitVectors(this.up, this.direction.multiplyScalar(1 / chordLength));
    this.arrow.scale.set(arrowLength * 0.25, chordLength, arrowLength * 0.25);
    this.arrow.visible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.remove(this.line, this.arrow);
    if (!this.geometryDisposed) this.geometry.dispose();
    if (!this.materialDisposed) this.material.dispose();
    if (!this.arrowGeometryDisposed) this.arrowGeometry.dispose();
    if (!this.arrowMaterialDisposed) this.arrowMaterial.dispose();
  }
}


