import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const cloudVertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const cloudFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uDaylight;
uniform vec3 uSunDir;
varying vec3 vWorldPos;

// Simplex-style 3D noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  vec3 shift = vec3(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * snoise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float starField(vec3 dir) {
  vec2 starUv = vec2(
    atan(dir.z, dir.x) / 6.28318530718 + 0.5,
    acos(clamp(dir.y, -1.0, 1.0)) / 3.14159265359
  );

  vec2 grid = vec2(260.0, 140.0);
  vec2 cell = starUv * grid;
  vec2 id = floor(cell);
  vec2 local = fract(cell) - 0.5;
  float rnd = hash21(id);

  float starMask = step(0.9972, rnd);
  float core = smoothstep(0.085, 0.0, length(local));
  float twinkle = 0.72 + 0.28 * sin(uTime * 1.7 + rnd * 130.0);
  float star = starMask * core * twinkle;

  float bigMask = step(0.99935, rnd);
  float cross = max(
    smoothstep(0.02, 0.0, abs(local.x)) * smoothstep(0.18, 0.0, abs(local.y)),
    smoothstep(0.02, 0.0, abs(local.y)) * smoothstep(0.18, 0.0, abs(local.x))
  );
  star += bigMask * cross * 0.9 * twinkle;

  return star * smoothstep(0.08, 0.35, dir.y);
}

void main() {
  // Normalize the direction from origin to the dome vertex
  vec3 dir = normalize(vWorldPos);

  // Only render clouds above the horizon
  float horizonFade = smoothstep(0.0, 0.15, dir.y);
  if (horizonFade <= 0.0) discard;

  // Project onto a flat plane for cloud UVs (dome -> flat mapping)
  vec2 uv = dir.xz / (dir.y + 0.001) * 0.04;

  // Animate wind drift
  float t = uTime * 0.012;
  vec3 pos = vec3(uv.x + t, uv.y + t * 0.3, t * 0.5);

  // Layer noise for cloud shapes
  float n = fbm(pos * 1.5);
  float n2 = fbm(pos * 3.0 + vec3(5.3, 1.2, 3.7));

  // Cloud density with sharp cutoff for puffy shapes
  float density = smoothstep(0.1, 0.55, n * 0.5 + 0.5);
  density *= smoothstep(0.05, 0.4, n2 * 0.5 + 0.5);

  // Sun-facing brightness
  float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
  float sunGlow = pow(sunDot, 8.0) * 0.3;

  // Shift cloud color and opacity toward a dimmer moonlit look at night.
  vec3 cloudBase = mix(vec3(0.24, 0.29, 0.38), vec3(1.0, 1.0, 1.0), uDaylight);
  vec3 cloudShadow = mix(vec3(0.07, 0.10, 0.16), vec3(0.75, 0.78, 0.85), uDaylight);
  vec3 cloudColor = mix(cloudShadow, cloudBase, density * mix(0.4, 0.7, uDaylight) + sunGlow);
  cloudColor += vec3(1.0, 0.9, 0.7) * sunGlow * uDaylight;

  float night = 1.0 - uDaylight;
  float cloudAlpha = density * horizonFade * mix(0.25, 0.85, uDaylight);
  float stars = starField(dir) * night * (1.0 - density * 0.92);
  vec3 starColor = vec3(0.88, 0.92, 1.0);
  float starAlpha = stars * 0.95;

  vec3 premultiplied = starColor * starAlpha * (1.0 - cloudAlpha) + cloudColor * cloudAlpha;
  float alpha = starAlpha * (1.0 - cloudAlpha) + cloudAlpha;
  if (alpha < 0.001) discard;

  gl_FragColor = vec4(premultiplied / max(alpha, 0.0001), alpha);
}
`

interface ProceduralCloudsProps {
  sunPosition?: [number, number, number]
  daylight?: number
}

export function ProceduralClouds({
  sunPosition = [100, 20, 100],
  daylight = 1
}: ProceduralCloudsProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uDaylight: { value: daylight },
    uSunDir: { value: new THREE.Vector3(...sunPosition).normalize() }
  }), [])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uDaylight.value = daylight
    uniforms.uSunDir.value.set(...sunPosition).normalize()
    // Clouds follow the camera horizontally so they never run out
    if (meshRef.current) {
      const cam = state.camera.position
      meshRef.current.position.set(cam.x, 0, cam.z)
    }
  })

  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <sphereGeometry args={[200, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <shaderMaterial
        vertexShader={cloudVertexShader}
        fragmentShader={cloudFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  )
}
