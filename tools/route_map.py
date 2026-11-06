"""Маршрут на карті курсу: уточнює центри галявинок-кружечків, ставить тренування в порядку доріжки
і прокладає лінію маршруту доріжками (по «пісочних» пікселях) від входу уроку через усі тренування
до входу наступного. Результат — у courses/<курс>/course.json:
  lessons[].place.spots  — точки тренувань (x%, y%), центр краплі-мітки = центр кружечка на карті
  lessons[].place.route  — відрізки маршруту: route[k] веде до тренування k (останній — до входу наступного уроку)
Запуск: python3 tools/route_map.py [курс] [прев'ю.png]"""
import json, sys, math
from itertools import permutations
import numpy as np
from PIL import Image, ImageDraw
from skimage.graph import route_through_array, MCP_Geometric

course = sys.argv[1] if len(sys.argv) > 1 else 'multiplication'
cpath = f'courses/{course}/course.json'
C = json.load(open(cpath)); L = C['lessons']
imgs = [Image.open(C['map']['image'].replace('{id}', str(l['id']))).convert('RGB') for l in L]
W, H = imgs[0].size
strip = Image.new('RGB', (W * len(imgs), H))
for i, im in enumerate(imgs): strip.paste(im.resize((W, H)), (i * W, 0))
F = np.asarray(strip).astype(float)                       # повна роздільність — для кружечків
lum = F.mean(-1)

# 1) уточнити центри кружечків: світла овальна середина, темніший обідок
def refine(i, xy):
    cx, cy = i * W + xy[0] / 100 * W, xy[1] / 100 * H
    yy, xx = np.mgrid[-40:41, -40:41]
    best = None
    for dy in range(-12, 13, 2):
        for dx in range(-12, 13, 2):
            for rx in (17, 20, 23):
                ry = rx * 0.66
                X, Y = int(cx + dx), int(cy + dy)
                if X - 40 < 0 or Y - 40 < 0 or X + 41 > lum.shape[1] or Y + 41 > lum.shape[0]: continue
                win = lum[Y - 40:Y + 41, X - 40:X + 41]
                r = (xx / rx) ** 2 + (yy / ry) ** 2
                inner, ring = win[r < 0.7], win[(r > 1.0) & (r < 1.5)]
                s = inner.mean() - ring.mean() - 0.5 * inner.std()
                if best is None or s > best[0]: best = (s, X, Y)
    _, X, Y = best
    return [round((X - i * W) / W * 100, 1), round(Y / H * 100, 1)]

for i, l in enumerate(L):
    pl = l['place']; n = pl.get('clearings', 0)
    pl['spots'] = [refine(i, xy) if k < n else xy for k, xy in enumerate(pl['spots'])]

# 2) карта вартості: пісочні доріжки дешеві
S = 2
A = np.asarray(strip.resize((strip.width // S, H // S), Image.LANCZOS)).astype(float)
def pt(i, xy): return (min(A.shape[0] - 1, int(xy[1] / 100 * H / S)), min(A.shape[1] - 1, int((i * W + xy[0] / 100 * W) / S)))
samples = []
for i, l in enumerate(L):
    for xy in l['place']['spots']:
        r, c = pt(i, xy); samples.append(A[max(0, r - 3):r + 4, max(0, c - 3):c + 4].reshape(-1, 3))
ref = np.median(np.concatenate(samples), axis=0)
R_, G_, B_ = A[..., 0], A[..., 1], A[..., 2]
sandy = (np.sqrt(((A - ref) ** 2).sum(-1)) < 60) & (R_ > B_ + 45) & (G_ > B_ + 20) & (R_ >= G_ - 5)
cost = np.where(sandy, 1.0, 300.0)
def snap(rc):
    r, c = rc; best = None
    for dr in range(-20, 21):
        for dc in range(-20, 21):
            rr, cc = r + dr, c + dc
            if 0 <= rr < A.shape[0] and 0 <= cc < A.shape[1] and sandy[rr, cc]:
                d = dr * dr + dc * dc
                if best is None or d < best[0]: best = (d, (rr, cc))
    return best[1] if best else rc

# 3) порядок тренувань — уздовж доріжки (найкоротший обхід від входу до виходу; екзамен-палац — останній)
for i, l in enumerate(L):
    pl = l['place']; sp = pl['spots']
    last_fixed = bool(l.get('exam'))
    free = sp[:-1] if last_fixed else sp
    out = sp[-1] if last_fixed else (L[i + 1]['place'].get('gate', [3, 50]) if i + 1 < len(L) else pl.get('out', [100, 50]))
    oi = i if last_fixed or i + 1 >= len(L) else i + 1
    nodes = [(i, pl.get('gate', [3, 50]))] + [(i, s) for s in free] + [(oi, out)]
    D = []
    for a in nodes:
        m = MCP_Geometric(cost); cum, _ = m.find_costs([snap(pt(*a))])
        D.append([cum[snap(pt(*b))] for b in nodes])
    n = len(free); best = None
    for perm in permutations(range(1, n + 1)):
        cst = D[0][perm[0]] + sum(D[perm[k]][perm[k + 1]] for k in range(n - 1)) + D[perm[-1]][n + 1]
        if best is None or cst < best[0]: best = (cst, perm)
    pl['spots'] = [free[k - 1] for k in best[1]] + ([sp[-1]] if last_fixed else [])
    pl.pop('clearings', None)

# 4) лінія маршруту
for i, l in enumerate(L):
    pl = l['place']
    pts = [(i, pl.get('gate', [3, 50]))] + [(i, s) for s in pl['spots']]
    if i + 1 < len(L): pts.append((i + 1, L[i + 1]['place'].get('gate', [3, 50])))
    out = pl.get('out', [100, 50])
    route = []
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        last = k == len(pts) - 2 and i + 1 < len(L)
        if last:   # перехід на наступний урок — через точку виходу (місток/дорога на краю картинки)
            o = pt(i, out); o = (o[0], min(A.shape[1] - 1, o[1]))
            p1, _ = route_through_array(cost, snap(pt(*a)), o, fully_connected=True, geometric=True)
            p2, _ = route_through_array(cost, o, snap(pt(*b)), fully_connected=True, geometric=True)
            path = p1 + p2[1:]
        else:
            path, _ = route_through_array(cost, snap(pt(*a)), snap(pt(*b)), fully_connected=True, geometric=True)
        path = np.array(path, float)
        if len(path) > 9:   # згладити ламану і проріджити
            k9 = np.ones(9) / 9
            sm = np.c_[np.convolve(np.pad(path[:, 0], 4, mode='edge'), k9, 'valid'), np.convolve(np.pad(path[:, 1], 4, mode='edge'), k9, 'valid')]
            path = np.r_[path[:1], sm[1:-1:4], path[-1:]]
        seg = []
        for r, c in path:
            x = c * S - i * W; y = r * S
            seg.append([round(x / W * 100, 1), round(y / H * 100, 1)])
        route.append(seg)
    pl['route'] = route

json.dump(C, open(cpath, 'w'), ensure_ascii=False, indent=2); open(cpath, 'a').write('\n')
print({l['id']: len(l['place']['spots']) for l in L})

if len(sys.argv) > 2:
    prev = strip.copy(); d = ImageDraw.Draw(prev)
    for i, l in enumerate(L):
        for seg in l['place']['route']:
            d.line([(i * W + x / 100 * W, y / 100 * H) for x, y in seg], fill=(30, 90, 255), width=4)
        for k, (x, y) in enumerate(l['place']['spots']):
            X, Y = i * W + x / 100 * W, y / 100 * H
            d.ellipse((X - 20, Y - 13, X + 20, Y + 13), outline=(255, 0, 0), width=3); d.text((X - 3, Y - 6), str(k + 1), fill=(255, 0, 0))
    prev.save(sys.argv[2])
