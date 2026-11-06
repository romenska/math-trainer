"""Стрілочки вздовж доріжок карти: шукає шлях по «пісочних» пікселях між сусідніми мітками
(вхід уроку → тренування 1 → … → тренування N → вхід наступного уроку) і записує в course.json
lessons[].place.arrows = [[x%, y%, кут°], ...]. Запуск: python3 tools/route_arrows.py [курс]"""
import json, sys, math
import numpy as np
from PIL import Image
from skimage.graph import route_through_array

course = sys.argv[1] if len(sys.argv) > 1 else 'multiplication'
cpath = f'courses/{course}/course.json'
C = json.load(open(cpath))
L = C['lessons']
imgs = [Image.open(C['map']['image'].replace('{id}', str(l['id']))).convert('RGB') for l in L]
W, H = imgs[0].size
S = 2                                                  # пошук на зменшеній удвічі картинці
strip = Image.new('RGB', (W * len(imgs), H))
for i, im in enumerate(imgs): strip.paste(im.resize((W, H)), (i * W, 0))
A = np.asarray(strip.resize((strip.width // S, H // S), Image.LANCZOS)).astype(float)

def pt(i, xy):  # % картинки уроку i → пікселі зменшеної смуги (рядок, стовпчик)
    return (min(A.shape[0] - 1, int(xy[1] / 100 * H / S)), min(A.shape[1] - 1, int((i * W + xy[0] / 100 * W) / S)))

# колір доріжки: медіана навколо точок тренувань (галявинки на доріжці)
samples = []
for i, l in enumerate(L):
    for xy in l['place'].get('spots', []):
        r, c = pt(i, xy); samples.append(A[max(0, r - 3):r + 4, max(0, c - 3):c + 4].reshape(-1, 3))
ref = np.median(np.concatenate(samples), axis=0)
r_, g_, b_ = A[..., 0], A[..., 1], A[..., 2]
dist = np.sqrt(((A - ref) ** 2).sum(-1))
sandy = (dist < 60) & (r_ > b_ + 45) & (g_ > b_ + 20) & (r_ >= g_ - 5)   # теплий пісок, не сірий камінь, не трава, не вода
cost = np.where(sandy, 1.0, 300.0)   # не-доріжкою — лише якщо інакше ніяк

def snap(rc):  # точку — на найближчий пісок (мітка може стояти поруч із доріжкою)
    r, c = rc; best = None
    for dr in range(-20, 21):
        for dc in range(-20, 21):
            rr, cc = r + dr, c + dc
            if 0 <= rr < A.shape[0] and 0 <= cc < A.shape[1] and sandy[rr, cc]:
                d = dr * dr + dc * dc
                if best is None or d < best[0]: best = (d, (rr, cc))
    return best[1] if best else rc

# --reorder: переставити точки тренувань у порядку доріжки (найкоротший обхід від входу до виходу),
# щоб стрілочки йшли в один бік, без повернень назад
if '--reorder' in sys.argv:
    from itertools import permutations
    from skimage.graph import MCP_Geometric
    def costs_from(i, xy, targets):
        m = MCP_Geometric(cost); cum, _ = m.find_costs([snap(pt(i, xy))])
        return [cum[snap(pt(i, t))] for t in targets]
    for i, l in enumerate(L):
        pl = l['place']; sp = pl.get('spots', [])
        fixed_last = bool(l.get('exam'))                      # екзамен — завжди останній (палац)
        free = sp[:-1] if fixed_last else sp
        gate = pl.get('gate', [3, 50]); out = sp[-1] if fixed_last else pl.get('out', [100, 50])
        nodes = [gate] + free + [out]
        D = [costs_from(i, a, nodes) for a in nodes]
        n = len(free); best = None
        for perm in permutations(range(1, n + 1)):
            c = D[0][perm[0]] + sum(D[perm[k]][perm[k + 1]] for k in range(n - 1)) + D[perm[-1]][n + 1]
            if best is None or c < best[0]: best = (c, perm)
        pl['spots'] = [free[k - 1] for k in best[1]] + ([sp[-1]] if fixed_last else [])
        print('урок', l['id'], 'порядок', best[1])

points = []   # [(урок, (x%, y%))] у порядку проходження
for i, l in enumerate(L):
    points.append((i, l['place'].get('gate', [3, 50])))
    for xy in l['place'].get('spots', []): points.append((i, xy))

arrows = {i: [] for i in range(len(L))}
placed = []
STEP, GAP = 44, 26     # крок між стрілками і відступ від міток (у пікселях зменшеної смуги)
for (ia, a), (ib, b) in zip(points, points[1:]):
    pa, pb = snap(pt(ia, a)), snap(pt(ib, b))
    path, _ = route_through_array(cost, pa, pb, fully_connected=True, geometric=True)
    path = np.array(path, float)
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(path, axis=0).T))]
    total = seg[-1]
    if total < 2 * GAP + 10: continue
    n = max(1, int((total - 2 * GAP) // STEP))
    for k in range(n):
        d = GAP + (total - 2 * GAP) * (k + 0.5) / n
        j = int(np.searchsorted(seg, d)); j = min(max(j, 1), len(path) - 1)
        j0, j1 = max(0, j - 6), min(len(path) - 1, j + 6)
        dy, dx = path[j1] - path[j0]
        ang = math.degrees(math.atan2(dy, dx))
        y, x = path[j] * S
        pi = min(len(L) - 1, int(x // W))
        # де доріжка вже має стрілочку (шлях іде тим самим відрізком назад) — другу не ставимо
        if any(abs(px - x) < 36 and abs(py - y) < 36 for px, py in placed): continue
        placed.append((x, y))
        arrows[pi].append([round((x - pi * W) / W * 100, 1), round(y / H * 100, 1), round(ang)])

for i, l in enumerate(L): l['place']['arrows'] = arrows[i]
json.dump(C, open(cpath, 'w'), ensure_ascii=False, indent=2); open(cpath, 'a').write('\n')
print({L[i]['id']: len(v) for i, v in arrows.items()})

# перевірка: смуга зі стрілками
from PIL import ImageDraw
prev = strip.copy(); d = ImageDraw.Draw(prev)
for i, v in arrows.items():
    for x, y, a in v:
        X, Y = i * W + x / 100 * W, y / 100 * H; r = math.radians(a)
        d.line((X - 9 * math.cos(r), Y - 9 * math.sin(r), X + 9 * math.cos(r), Y + 9 * math.sin(r)), fill=(220, 0, 0), width=4)
        d.ellipse((X + 9 * math.cos(r) - 4, Y + 9 * math.sin(r) - 4, X + 9 * math.cos(r) + 4, Y + 9 * math.sin(r) + 4), fill=(220, 0, 0))
prev.save(sys.argv[2] if len(sys.argv) > 2 else '/tmp/arrows-preview.png')
