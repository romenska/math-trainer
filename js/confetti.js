// Маленьке конфеті без сторонньої бібліотеки (~1 КБ замість окремого скрипта з CDN).
export function confetti(host = document.body) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.width = innerWidth * dpr;
  const H = canvas.height = innerHeight * dpr;
  const colors = ['#2f6fed', '#f59e0b', '#16a34a', '#ec4899', '#7c3aed', '#facc15'];
  const parts = Array.from({ length: 120 }, () => ({
    x: W / 2, y: H * 0.6,
    vx: (Math.random() - 0.5) * 18 * dpr,
    vy: (-Math.random() * 16 - 6) * dpr,
    s: (Math.random() * 6 + 4) * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.5 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - start < 2600) requestAnimationFrame(frame); else canvas.remove();
  })(start);
}
