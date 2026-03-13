import type { TicketStatus } from "@/lib/types";

type ToneStep = {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
};

let audioContext: AudioContext | null = null;
let unlockBound = false;
let lastPlayedAt = 0;

const MIN_PLAY_GAP_MS = 160;

const STATUS_PRIORITY: Record<TicketStatus, number> = {
  blocked: 6,
  doing: 5,
  done: 4,
  open: 3,
  wontfix: 2,
  parked: 1,
};

const TONE_PATTERNS: Record<TicketStatus, ToneStep[]> = {
  open: [{ freq: 530, duration: 0.08, type: "triangle", gain: 0.028 }],
  doing: [
    { freq: 620, duration: 0.08, type: "sine", gain: 0.03 },
    { freq: 700, duration: 0.08, type: "sine", gain: 0.03 },
  ],
  blocked: [
    { freq: 230, duration: 0.12, type: "square", gain: 0.03 },
    { freq: 180, duration: 0.12, type: "square", gain: 0.03 },
  ],
  done: [
    { freq: 760, duration: 0.07, type: "triangle", gain: 0.03 },
    { freq: 980, duration: 0.1, type: "triangle", gain: 0.03 },
  ],
  wontfix: [{ freq: 300, duration: 0.12, type: "sawtooth", gain: 0.02 }],
  parked: [{ freq: 260, duration: 0.08, type: "sine", gain: 0.018 }],
};

function getAudioContextConstructor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const maybeWindow = window as Window & { webkitAudioContext?: new () => AudioContext };
  return window.AudioContext || maybeWindow.webkitAudioContext || null;
}

function getAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  if (!audioContext) {
    audioContext = new Ctor();
  }
  return audioContext;
}

function bindUnlockListeners(): void {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;

  const unlock = () => {
    const context = getAudioContext();
    if (!context) return;
    void context.resume().catch(() => {});
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

function withRunningAudioContext(callback: (context: AudioContext) => void): void {
  const context = getAudioContext();
  if (!context) return;

  if (context.state === "running") {
    callback(context);
    return;
  }

  void context
    .resume()
    .then(() => {
      if (context.state === "running") {
        callback(context);
      }
    })
    .catch(() => {});
}

function scheduleToneStep(context: AudioContext, step: ToneStep, startAt: number): number {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const gain = Math.max(0.001, Math.min(0.05, step.gain ?? 0.028));
  const duration = Math.max(0.04, step.duration);
  const endAt = startAt + duration;

  oscillator.type = step.type || "sine";
  oscillator.frequency.setValueAtTime(step.freq, startAt);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(endAt + 0.01);

  return endAt + 0.03;
}

export function primeSoundEffects(): void {
  bindUnlockListeners();
}

export function dominantStatusForTone(statuses: TicketStatus[]): TicketStatus {
  return statuses.reduce<TicketStatus>((current, candidate) =>
    STATUS_PRIORITY[candidate] > STATUS_PRIORITY[current] ? candidate : current
  , "parked");
}

export function playStatusChangeTone(status: TicketStatus): void {
  bindUnlockListeners();
  const pattern = TONE_PATTERNS[status] || TONE_PATTERNS.parked;

  withRunningAudioContext((context) => {
    const nowMs = Date.now();
    if (nowMs - lastPlayedAt < MIN_PLAY_GAP_MS) return;
    lastPlayedAt = nowMs;

    let cursor = context.currentTime + 0.01;
    for (const step of pattern) {
      cursor = scheduleToneStep(context, step, cursor);
    }
  });
}
