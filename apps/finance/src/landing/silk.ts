/**
 * The hero's moving silk background, from the approved drawing: broad diagonal
 * folds lit from the upper left, nudged by the pointer. It pauses while the hero
 * is off screen or the tab is hidden, draws 1 still frame for reduced motion,
 * and leaves the hero's flat colour when WebGL is missing.
 */

const VERTEX = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FRAGMENT = `precision highp float;uniform vec2 r;uniform float t;uniform vec2 m;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*f*(f*(f*6.-15.)+10.);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*vn(p);p=p*2.03+vec2(3.1,7.7);a*=.5;}return v;}
float silk(vec2 p,float tt){vec2 d=vec2(.82,.57);float x=dot(p,d);float y=dot(p,vec2(-d.y,d.x));
float bend=fbm(vec2(y*.55,tt*.6))*2.2+fbm(vec2(x*.35+4.,tt*.4))*.8;
float u=x*4.4+bend*2.6;return sin(u)*.55+sin(u*.53+1.7+tt*.3)*.35+sin(u*1.91-.6)*.1;}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.);float tt=t*.06;
float e=.004;float z=silk(p,tt);float zx=silk(p+vec2(e,0.),tt)-z;float zy=silk(p+vec2(0.,e),tt)-z;
vec3 n=normalize(vec3(-zx/e*.42,-zy/e*.42,1.));vec3 L=normalize(vec3(-.5+(m.x-.5)*.6,.55+(m.y-.5)*.4,.72));
float dif=clamp(dot(n,L),0.,1.);float spec=pow(clamp(dot(reflect(-L,n),vec3(0,0,1)),0.,1.),14.);float sheen=pow(dif,4.);
vec3 base=vec3(.028,.085,.115);vec3 mid=vec3(.05,.33,.41);vec3 hi=vec3(.42,.80,.88);
vec3 c=base*(.5+.8*dif)+mid*sheen*1.25+hi*spec*1.1;
float edge=smoothstep(1.25,.25,distance(uv,vec2(.62,.55)));c*=mix(.6,1.,edge);
float text=smoothstep(.62,.05,uv.x)*smoothstep(.1,.55,uv.y);c*=1.-text*.32;
c+=(h(gl_FragCoord.xy+fract(t))-.5)/255.;gl_FragColor=vec4(c,1.);}`;

export interface Silk {
  /** Pointer position as fractions of the hero, origin bottom left. */
  point: (x: number, y: number) => void;
  setVisible: (visible: boolean) => void;
  stop: () => void;
}

export function startSilk(canvas: HTMLCanvasElement): Silk | null {
  const gl = canvas.getContext('webgl');
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(program, 'r');
  const uT = gl.getUniformLocation(program, 't');
  const uM = gl.getUniformLocation(program, 'm');

  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const target = [0.7, 0.6];
  const eased = [0.7, 0.6];
  const started = performance.now();
  let visible = true;
  let stopped = false;
  let frame = 0;

  const draw = () => {
    frame = 0;
    if (stopped) return;
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    eased[0] += (target[0] - eased[0]) * 0.04;
    eased[1] += (target[1] - eased[1]) * 0.04;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(uR, w, h);
    gl.uniform1f(uT, still ? 12 : (performance.now() - started) / 1000);
    gl.uniform2f(uM, eased[0], eased[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!still && visible && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const resume = () => {
    if (!frame && !still && visible && !document.hidden) frame = requestAnimationFrame(draw);
  };
  // The still frame is redrawn whenever the hero changes size (a window resize,
  // or text reflowing once the fonts arrive), so it is never stretched.
  const onResize = () => {
    if (still) draw();
  };
  const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  sized?.observe(canvas);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('resize', onResize);
  draw();

  return {
    point(x, y) {
      target[0] = x;
      target[1] = y;
    },
    setVisible(next) {
      visible = next;
      resume();
    },
    stop() {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      sized?.disconnect();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('resize', onResize);
    },
  };
}
