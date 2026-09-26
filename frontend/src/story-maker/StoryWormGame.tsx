import { useEffect, useRef, useState, useCallback } from 'react';
import './StoryWormGame.css';

type Props = {
  onCancel?: () => void;
};

type Point = { x: number; y: number };

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
};

type FloatingText = {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
};

const GRID_COLS = 16;
const GRID_ROWS = 14;
const INITIAL_SNAKE: Point[] = [
  { x: 5, y: 7 },
  { x: 4, y: 7 },
  { x: 3, y: 7 }
];

// Audio synthesizer for delightful, lag-free sound effects
let sharedAudioCtx: AudioContext | null = null;

function playSound(type: 'apple' | 'star' | 'bump', muted: boolean) {
  if (muted || typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') void sharedAudioCtx.resume();

    const ctx = sharedAudioCtx;
    const now = ctx.currentTime;

    if (type === 'apple') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(840, now + 0.08);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (type === 'star') {
      [659.25, 830.61, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.06);
        gain.gain.setValueAtTime(0.14, now + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.06 + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.06);
        osc.stop(now + i * 0.06 + 0.14);
      });
    } else if (type === 'bump') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch {
    /* Ignore audio restrictions */
  }
}

export default function StoryWormGame({ onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try {
      return Number(localStorage.getItem('danoa_worm_highscore') || '0');
    } catch {
      return 0;
    }
  });

  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem('danoa_worm_muted') === 'true';
    } catch {
      return false;
    }
  });

  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
    try {
      localStorage.setItem('danoa_worm_muted', String(isMuted));
    } catch {
      /* ignore */
    }
  }, [isMuted]);

  // Core game states stored in refs for buttery-smooth 60fps loop
  const snakeRef = useRef<Point[]>([...INITIAL_SNAKE]);
  const dirRef = useRef<{ dx: number; dy: number }>({ dx: 1, dy: 0 });
  const nextDirRef = useRef<{ dx: number; dy: number }>({ dx: 1, dy: 0 });
  const appleRef = useRef<Point>({ x: 11, y: 7 });
  const starRef = useRef<Point | null>(null);
  const scoreRef = useRef(0);
  const eyeBlinkRef = useRef(0);
  const mouthOpenRef = useRef(false);
  const headSquashRef = useRef(1);

  // Particles & floating texts
  const particlesRef = useRef<Particle[]>([]);
  const floatingTextsRef = useRef<FloatingText[]>([]);

  // Story encouragement messages
  const getEncouragement = (s: number) => {
    if (s >= 16) return '👑 وای ترکوندی! سناریونویس نابغه قصه ما تویی!';
    if (s >= 10) return '🚀 چه دست‌فرمونی! قهرمان داستانمون حسابی ذوق کرده!';
    if (s >= 5) return '✨ عالیه! دیالوگ‌ها و صحنه‌های جذاب دارن چیده می‌شن!';
    return '🍎 به کرم کوچولو سیب بده تا صحنه‌ها زودتر آماده بشن!';
  };

  const spawnFood = useCallback((snake: Point[]): Point => {
    let p: Point;
    let attempts = 0;
    do {
      p = {
        x: Math.floor(Math.random() * GRID_COLS),
        y: Math.floor(Math.random() * GRID_ROWS)
      };
      attempts++;
    } while (attempts < 100 && snake.some((seg) => seg.x === p.x && seg.y === p.y));
    return p;
  }, []);

  const changeDirection = useCallback((dx: number, dy: number) => {
    const current = dirRef.current;
    if (current.dx + dx === 0 && current.dy + dy === 0) return;
    nextDirRef.current = { dx, dy };
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          e.preventDefault();
          changeDirection(0, -1);
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          e.preventDefault();
          changeDirection(0, 1);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          changeDirection(-1, 0);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          changeDirection(1, 0);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeDirection]);

  // Touch and Pointer Steering (Swipe + Tap Steering)
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const hasMovedInGestureRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    hasMovedInGestureRef.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointerStartPosRef.current) return;
    const dx = e.clientX - pointerStartPosRef.current.x;
    const dy = e.clientY - pointerStartPosRef.current.y;
    const distanceSq = dx * dx + dy * dy;

    // Minimum swipe threshold (18px) for instant gesture reaction
    if (distanceSq >= 324) {
      hasMovedInGestureRef.current = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        changeDirection(dx > 0 ? 1 : -1, 0);
      } else {
        changeDirection(0, dy > 0 ? 1 : -1);
      }
      // Reset start to current to allow fluid continuous dragging turns!
      pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // If the child just tapped without swiping, steer relative to snake head!
    if (pointerStartPosRef.current && !hasMovedInGestureRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const cellW = rect.width / GRID_COLS;
      const cellH = rect.height / GRID_ROWS;
      const head = snakeRef.current[0] || { x: 5, y: 7 };
      const headCenterX = head.x * cellW + cellW / 2;
      const headCenterY = head.y * cellH + cellH / 2;

      const diffX = clickX - headCenterX;
      const diffY = clickY - headCenterY;

      if (Math.abs(diffX) > Math.abs(diffY)) {
        changeDirection(diffX > 0 ? 1 : -1, 0);
      } else {
        changeDirection(0, diffY > 0 ? 1 : -1);
      }
    }
    pointerStartPosRef.current = null;
    hasMovedInGestureRef.current = false;
  };

  // Main game tick and 60fps visual loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let tickTimer: ReturnType<typeof setInterval>;
    let animFrame: number;

    const spawnParticles = (cx: number, cy: number, color: string, count = 10) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.8 + 1.2;
        particlesRef.current.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: Math.random() * 3 + 2,
          alpha: 1
        });
      }
    };

    const addFloatingText = (cx: number, cy: number, text: string, color: string) => {
      floatingTextsRef.current.push({
        x: cx,
        y: cy,
        text,
        color,
        alpha: 1,
        vy: -1.2
      });
    };

    const gameTick = () => {
      dirRef.current = nextDirRef.current;
      const snake = snakeRef.current;
      const head = snake[0];
      if (!head) return;

      // Wrap-around walls (no frustrating deaths for kids)
      const nextX = (head.x + dirRef.current.dx + GRID_COLS) % GRID_COLS;
      const nextY = (head.y + dirRef.current.dy + GRID_ROWS) % GRID_ROWS;
      const newHead: Point = { x: nextX, y: nextY };

      // Self-collision: gently trim tail instead of harsh game over
      const selfCollideIdx = snake.findIndex((seg, idx) => idx > 0 && seg.x === newHead.x && seg.y === newHead.y);
      let newSnake: Point[];

      if (selfCollideIdx !== -1) {
        playSound('bump', isMutedRef.current);
        newSnake = snake.slice(0, Math.max(3, selfCollideIdx));
        const cellW = canvas.width / GRID_COLS;
        const cellH = canvas.height / GRID_ROWS;
        spawnParticles(newHead.x * cellW + cellW / 2, newHead.y * cellH + cellH / 2, '#94a3b8', 6);
      } else {
        newSnake = [newHead, ...snake];
      }

      // Check eating apple
      let ate = false;
      const cellW = canvas.width / GRID_COLS;
      const cellH = canvas.height / GRID_ROWS;

      if (newHead.x === appleRef.current.x && newHead.y === appleRef.current.y) {
        ate = true;
        headSquashRef.current = 1.35;
        playSound('apple', isMutedRef.current);

        const newScore = scoreRef.current + 1;
        scoreRef.current = newScore;
        setScore(newScore);
        if (newScore > highScore) {
          setHighScore(newScore);
          try {
            localStorage.setItem('danoa_worm_highscore', String(newScore));
          } catch {
            /* ignore */
          }
        }

        const applePxX = appleRef.current.x * cellW + cellW / 2;
        const applePxY = appleRef.current.y * cellH + cellH / 2;
        spawnParticles(applePxX, applePxY, '#ef4444', 12);
        addFloatingText(applePxX, applePxY - 8, '+۱ 🍎', '#dc2626');

        appleRef.current = spawnFood(newSnake);

        // 30% chance for golden star
        if (!starRef.current && Math.random() < 0.3) {
          starRef.current = spawnFood(newSnake);
        }
      }

      // Check eating star
      if (starRef.current && newHead.x === starRef.current.x && newHead.y === starRef.current.y) {
        ate = true;
        headSquashRef.current = 1.45;
        playSound('star', isMutedRef.current);

        const newScore = scoreRef.current + 3;
        scoreRef.current = newScore;
        setScore(newScore);

        const starPxX = starRef.current.x * cellW + cellW / 2;
        const starPxY = starRef.current.y * cellH + cellH / 2;
        spawnParticles(starPxX, starPxY, '#f59e0b', 18);
        addFloatingText(starPxX, starPxY - 8, '+۳ ⭐', '#b45309');

        starRef.current = null;
      }

      if (!ate && selfCollideIdx === -1) {
        newSnake.pop();
      }

      // Check if head is near food to open mouth excited
      const targetFood = starRef.current || appleRef.current;
      const dist = Math.abs(newHead.x - targetFood.x) + Math.abs(newHead.y - targetFood.y);
      mouthOpenRef.current = dist <= 2;

      snakeRef.current = newSnake;
    };

    tickTimer = setInterval(gameTick, 135);

    // 60FPS Render Loop
    let time = 0;
    const render = () => {
      time += 0.05;
      eyeBlinkRef.current = (eyeBlinkRef.current + 1) % 170;
      const isBlinking = eyeBlinkRef.current > 163;

      // Soft squash decay
      headSquashRef.current += (1 - headSquashRef.current) * 0.15;

      const width = canvas.width;
      const height = canvas.height;
      const cellW = width / GRID_COLS;
      const cellH = height / GRID_ROWS;

      ctx.clearRect(0, 0, width, height);

      // 1. Playful garden grid pattern (subtle checkerboard)
      for (let c = 0; c < GRID_COLS; c++) {
        for (let r = 0; r < GRID_ROWS; r++) {
          const isEven = (c + r) % 2 === 0;
          ctx.fillStyle = isEven ? '#f8fafc' : '#f1f5f9';
          ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
        }
      }

      // 2. Draw Bonus Star
      if (starRef.current) {
        const sx = starRef.current.x * cellW + cellW / 2;
        const sy = starRef.current.y * cellH + cellH / 2;
        const pulse = Math.sin(time * 4) * 2;
        const starRadius = cellW * 0.44 + pulse;

        ctx.save();
        ctx.fillStyle = '#f59e0b';
        ctx.shadowColor = 'rgba(245, 158, 11, 0.6)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
          const outerX = sx + Math.cos(angle) * starRadius;
          const outerY = sy + Math.sin(angle) * starRadius;
          if (i === 0) ctx.moveTo(outerX, outerY);
          else ctx.lineTo(outerX, outerY);

          const innerAngle = angle + Math.PI / 5;
          const innerX = sx + Math.cos(innerAngle) * (starRadius * 0.48);
          const innerY = sy + Math.sin(innerAngle) * (starRadius * 0.48);
          ctx.lineTo(innerX, innerY);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // 3. Draw Apple with gentle breathing bounce
      const ax = appleRef.current.x * cellW + cellW / 2;
      const ay = appleRef.current.y * cellH + cellH / 2;
      const appleBounce = Math.sin(time * 3) * 1.5;
      const appleRadius = cellW * 0.39 + appleBounce * 0.4;

      ctx.save();
      // Apple body
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = 'rgba(239, 68, 68, 0.4)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(ax, ay + 1, appleRadius, 0, Math.PI * 2);
      ctx.fill();

      // Apple leaf
      ctx.fillStyle = '#22c55e';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(ax + 3, ay - appleRadius + 1, 4.5, 2.8, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();

      // Apple highlight shine
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.arc(ax - 3, ay - 2.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 4. Draw Snake / Worm
      const snake = snakeRef.current;
      const foodPos = starRef.current || appleRef.current;

      for (let i = snake.length - 1; i >= 0; i--) {
        const seg = snake[i];
        if (!seg) continue;
        const cx = seg.x * cellW + cellW / 2;
        const cy = seg.y * cellH + cellH / 2;

        ctx.save();
        if (i === 0) {
          // Head with squash & stretch
          const radius = cellW * 0.47 * headSquashRef.current;

          ctx.fillStyle = '#10b981';
          ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();

          // Cheerful open mouth when close to food
          if (mouthOpenRef.current) {
            ctx.fillStyle = '#b91c1c';
            ctx.beginPath();
            const mouthX = cx + dirRef.current.dx * (radius * 0.55);
            const mouthY = cy + dirRef.current.dy * (radius * 0.55);
            ctx.arc(mouthX, mouthY, radius * 0.3, 0, Math.PI * 2);
            ctx.fill();
          }

          // Eyes looking directly at nearest food!
          if (!isBlinking) {
            const dx = dirRef.current.dx;
            const dy = dirRef.current.dy;
            const eyeOffset = radius * 0.36;
            const eyeR = radius * 0.28;

            const perpX = -dy;
            const perpY = dx;
            const eye1X = cx + dx * 2 + perpX * eyeOffset;
            const eye1Y = cy + dy * 2 + perpY * eyeOffset;
            const eye2X = cx + dx * 2 - perpX * eyeOffset;
            const eye2Y = cy + dy * 2 - perpY * eyeOffset;

            // White eye balls
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(eye1X, eye1Y, eyeR, 0, Math.PI * 2);
            ctx.arc(eye2X, eye2Y, eyeR, 0, Math.PI * 2);
            ctx.fill();

            // Pupil angle pointing at food
            const targetX = foodPos.x * cellW + cellW / 2;
            const targetY = foodPos.y * cellH + cellH / 2;
            const angleToFood = Math.atan2(targetY - cy, targetX - cx);
            const pupilShiftX = Math.cos(angleToFood) * 1.8;
            const pupilShiftY = Math.sin(angleToFood) * 1.8;

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(eye1X + pupilShiftX, eye1Y + pupilShiftY, eyeR * 0.54, 0, Math.PI * 2);
            ctx.arc(eye2X + pupilShiftX, eye2Y + pupilShiftY, eyeR * 0.54, 0, Math.PI * 2);
            ctx.fill();

            // Tiny eye shine
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(eye1X + pupilShiftX - 1, eye1Y + pupilShiftY - 1, 1.2, 0, Math.PI * 2);
            ctx.arc(eye2X + pupilShiftX - 1, eye2Y + pupilShiftY - 1, 1.2, 0, Math.PI * 2);
            ctx.fill();

            // Cute blush cheeks
            ctx.fillStyle = 'rgba(244, 114, 182, 0.65)';
            ctx.beginPath();
            ctx.arc(cx + perpX * (radius * 0.68), cy + perpY * (radius * 0.68), 3.2, 0, Math.PI * 2);
            ctx.arc(cx - perpX * (radius * 0.68), cy - perpY * (radius * 0.68), 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Body segments with organic breathing
          const radius = cellW * (0.39 - Math.min(0.12, (i / snake.length) * 0.1));
          const isAlt = i % 2 === 0;
          ctx.fillStyle = isAlt ? '#34d399' : '#10b981';
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 5. Draw and update particles
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.035;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6. Draw and update floating texts (+1, +3)
      const texts = floatingTextsRef.current;
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        if (!t) continue;
        t.y += t.vy;
        t.alpha -= 0.025;

        if (t.alpha <= 0) {
          texts.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = t.alpha;
        ctx.fillStyle = t.color;
        ctx.font = 'bold 16px Vazirmatn, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
      }

      animFrame = requestAnimationFrame(render);
    };

    animFrame = requestAnimationFrame(render);

    return () => {
      clearInterval(tickTimer);
      cancelAnimationFrame(animFrame);
    };
  }, [highScore, spawnFood]);

  return (
    <div className="story-worm-game" dir="rtl">
      {/* Game Header Bar */}
      <div className="story-worm-game__bar">
        <div className="story-worm-game__tag">
          <span className="story-worm-game__tag-icon">🐛</span>
          <strong>کرم کوچولوی سناریونویس</strong>
        </div>
        <div className="story-worm-game__stats">
          <span className="story-worm-game__score">
            🍎 سیب‌ها: <strong>{score}</strong>
          </span>
          <span className="story-worm-game__highscore">
            🏆 رکورد: <strong>{highScore}</strong>
          </span>
          <button
            type="button"
            className="story-worm-game__mute-btn"
            onClick={() => setIsMuted((m) => !m)}
            aria-label={isMuted ? 'روشن کردن صدا' : 'قطع صدا'}
            title={isMuted ? 'روشن کردن صدا' : 'قطع صدا'}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* Encouragement Notice */}
      <div className="story-worm-game__caption">
        <p>{getEncouragement(score)}</p>
      </div>

      {/* Game Canvas Area with Full Surface Touch/Pointer Tracking */}
      <div
        ref={boardRef}
        className="story-worm-game__board"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          pointerStartPosRef.current = null;
          hasMovedInGestureRef.current = false;
        }}
      >
        <canvas
          ref={canvasRef}
          width={384}
          height={336}
          className="story-worm-game__canvas"
          aria-label="زمین بازی کرم کوچولو"
        />

        {/* Ambient gesture instruction watermark (fades away once score > 1) */}
        {score === 0 ? (
          <div className="story-worm-game__overlay-hint" aria-hidden="true">
            <span>👆 برای هدایت، انگشتت را بکش یا ضربه بزن</span>
          </div>
        ) : null}
      </div>

      {/* Background AI generation progress bar */}
      <div className="story-worm-game__scenario-status" role="status" aria-live="polite">
        <div className="story-worm-game__scenario-status-head">
          <span className="story-worm-game__sparkle-icon">✨</span>
          <span>دانوآ در حال خلق صحنه‌ها و دیالوگ‌های شگفت‌انگیز قصه...</span>
        </div>
        <div className="story-worm-game__progress-line" aria-hidden="true">
          <i />
        </div>
      </div>

      {/* Bottom Minimal Actions */}
      <div className="story-worm-game__footer">
        {onCancel ? (
          <button
            type="button"
            className="story-worm-game__cancel"
            onClick={onCancel}
          >
            لغو ساخت سناریو
          </button>
        ) : null}
      </div>
    </div>
  );
}
