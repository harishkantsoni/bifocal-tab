from PIL import Image, ImageDraw
import math, os

# ---- palettes -------------------------------------------------------------
# pane = search half (gradient), plate = dial half (gradient), tile, glyph
PALETTES = {
 "azure":   dict(pane=((56,189,248),(2,132,199)),   plate=((17,25,40),(8,12,20)),   tile=(241,245,249), glyph=(7,89,133)),
 "indigo":  dict(pane=((129,140,248),(79,70,229)),  plate=((19,20,31),(10,11,18)),  tile=(238,240,247), glyph=(49,46,129)),
 "violet":  dict(pane=((192,132,252),(124,58,237)), plate=((23,18,36),(12,9,20)),   tile=(243,238,252), glyph=(76,29,149)),
 "emerald": dict(pane=((52,211,153),(5,150,105)),   plate=((12,22,20),(6,12,11)),   tile=(236,253,245), glyph=(6,78,59)),
 "sunset":  dict(pane=((251,146,60),(234,88,12)),   plate=((26,20,16),(13,10,8)),   tile=(255,247,237), glyph=(124,45,18)),
 "slate":   dict(pane=((148,163,184),(71,85,105)),  plate=((15,18,24),(7,9,13)),    tile=(248,250,252), glyph=(30,41,59)),
}

def vgrad(w, h, top, bot):
    g = Image.new("RGB", (1, h)); px = g.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(round(top[i] + (bot[i]-top[i])*t) for i in range(3))
    return g.resize((w, h), Image.NEAREST)

def geom(S):
    g = {}
    g["r_bg"]   = max(2, round(0.20*S))
    g["left_w"] = round(0.50*S)
    g["r_left"] = max(1, round(0.07*S))
    pad         = max(1, round(0.07*S))
    g["f_w"]    = g["left_w"] - 2*pad
    g["f_h"]    = max(2, round(0.17*S) if S >= 48 else round(0.10*S))
    g["f_x"]    = pad
    g["f_y"]    = (S - g["f_h"]) // 2
    g["f_r"]    = g["f_h"] // 2
    avail       = S - g["left_w"]
    g["cell"]   = max(1, round(0.16*S))
    g["tgap"]   = max(1, round(0.07*S))
    grid        = 2*g["cell"] + g["tgap"]
    g["gx"]     = g["left_w"] + (avail - grid)//2
    g["gy"]     = (S - grid)//2
    g["r_tile"] = max(1, round(g["cell"]*0.28))
    return g

def magnifier(d, cx, cy, r, w, color):
    """Ring + 45-degree handle with round caps, in supersampled coords."""
    d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=color, width=int(round(w)))
    k = 0.7071
    x0, y0 = cx + r*k, cy + r*k
    x1, y1 = cx + (r + r*0.95)*k, cy + (r + r*0.95)*k
    d.line([x0, y0, x1, y1], fill=color, width=int(round(w)))
    cap = w/2
    for (px, py) in ((x0, y0), (x1, y1)):
        d.ellipse([px-cap, py-cap, px+cap, py+cap], fill=color)

def render(S, pal):
    P  = PALETTES[pal]
    ss = max(1, min(16, 2048//S))
    W  = S*ss
    g  = geom(S)

    img  = Image.new("RGBA", (W, W), (0,0,0,0))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0,0,W-1,W-1], radius=g["r_bg"]*ss, fill=255)
    img.paste(vgrad(W, W, *P["plate"]).convert("RGBA"), (0,0), mask)

    lw    = g["left_w"]*ss
    pmask = Image.new("L", (lw, W), 0)
    pd    = ImageDraw.Draw(pmask)
    pd.rounded_rectangle([0,0,lw-1,W-1], radius=g["r_left"]*ss, fill=255)
    pd.rectangle([lw-g["r_left"]*ss-1, 0, lw-1, W-1], fill=255)
    layer = Image.new("RGBA", (W, W), (0,0,0,0))
    layer.paste(vgrad(lw, W, *P["pane"]).convert("RGBA"), (0,0), pmask)
    img = Image.alpha_composite(img, Image.composite(layer, Image.new("RGBA",(W,W),(0,0,0,0)), mask))

    d = ImageDraw.Draw(img)

    # search field
    fx, fy, fw, fh = g["f_x"]*ss, g["f_y"]*ss, g["f_w"]*ss, g["f_h"]*ss
    d.rounded_rectangle([fx, fy, fx+fw-1, fy+fh-1], radius=g["f_r"]*ss, fill=P["tile"]+(255,))

    # magnifier + query line inside it (only where there is room to read)
    if S >= 48:
        cy   = fy + fh/2
        r    = fh*0.27
        strk = max(1.0, fh*0.115)
        cx   = fx + fh*0.52
        magnifier(d, cx, cy, r, strk, P["glyph"]+(255,))
        qx0 = cx + r*1.9 + strk
        qx1 = fx + fw - fh*0.34
        qh  = max(1.0, fh*0.15)
        if qx1 > qx0:
            d.rounded_rectangle([qx0, cy-qh/2, qx1, cy+qh/2], radius=qh/2,
                                fill=P["glyph"]+(150,))

    # speed-dial tiles
    step = g["cell"] + g["tgap"]
    for row in range(2):
        for col in range(2):
            x0 = (g["gx"] + col*step)*ss
            y0 = (g["gy"] + row*step)*ss
            d.rounded_rectangle([x0, y0, x0+g["cell"]*ss-1, y0+g["cell"]*ss-1],
                                radius=g["r_tile"]*ss, fill=P["tile"]+(255,))

    if S >= 32:
        d.rounded_rectangle([0,0,W-1,W-1], radius=g["r_bg"]*ss,
                            outline=(255,255,255,38), width=max(1,ss))

    return img.resize((S,S), Image.LANCZOS) if ss > 1 else img

if __name__ == "__main__":
    import sys
    pal = sys.argv[1] if len(sys.argv) > 1 else "azure"
    out = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\harish\Desktop\work\focus_extention\icons"
    os.makedirs(out, exist_ok=True)
    for S in (16,32,48,128):
        render(S, pal).save(os.path.join(out, f"icon{S}.png"), optimize=True)
    render(512, pal).save(os.path.join(os.path.dirname(out), "store", "icon512.png"), optimize=True)
    print("wrote", pal)
