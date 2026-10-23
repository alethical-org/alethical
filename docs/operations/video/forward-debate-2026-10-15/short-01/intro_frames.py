"""Draw the 54 intro frames (1.8 s at 30 fps): the Alethical symbol growing from 496 to 570 px wide on #0a0a0a.
Run: uvx --with pillow python -I intro_frames.py   (writes intro-frames/f000.png ... f053.png next to this file)
Each frame is drawn 8x larger and shrunk with Lanczos so the growth is smooth; whole-pixel scaling shook."""
import sys
from PIL import Image
import os; W=os.path.dirname(os.path.abspath(__file__)); os.makedirs(f"{W}/intro-frames",exist_ok=True)
sym=Image.open(f"{W}/assets/alethical-symbol-transparent.png").convert("RGBA"); sw,sh=sym.size
FPS=30; DUR=1.8; N=int(FPS*DUR); SS=8; BOX=800            # 800x800 output box around the logo, drawn 4x
bx,by=540-BOX//2,900-BOX//2
for k in range(N):
    t=k/FPS; w=496+74*(t/DUR); s=w*SS/sw
    a=1/s; c=sw/2-(BOX*SS/2)*a                              # map 4x box pixels to source pixels, centered
    big=sym.transform((BOX*SS,BOX*SS),Image.AFFINE,(a,0,c,0,a,sh/2-(BOX*SS/2)*a),resample=Image.BICUBIC,fillcolor=(0,0,0,0))
    small=big.resize((BOX,BOX),Image.LANCZOS)               # smooth shrink, no skipped pixels
    alpha=min(1,t/0.35); fo=min(1,(DUR-t)/0.2); g=alpha*fo
    if g<1:
        r,gg,b,al=small.split(); small=Image.merge("RGBA",(r,gg,b,al.point(lambda v:int(v*g))))
    frame=Image.new("RGBA",(1080,1920),(10,10,10,255)); frame.alpha_composite(small,(bx,by))
    frame.convert("RGB").save(f"{W}/intro-frames/f{k:03d}.png")
print(N,"frames")
