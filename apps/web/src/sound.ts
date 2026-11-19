/**
 * Лёгкий синтезатор звуков (Web Audio API) и тактильного отклика (вибрации на мобильных)
 */
class SoundAndHaptics {
  public enabled = true;
  private ctx: AudioContext | null = null;

  constructor() {
    const saved = localStorage.getItem('dual_tetris_sound');
    if (saved === '0') this.enabled = false;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem('dual_tetris_sound', this.enabled ? '1' : '0');
    return this.enabled;
  }

  private getCtx(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  vibrate(pattern: number | number[]): void {
    if (!this.enabled) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Игнорируем на iOS/десктопе
      }
    }
  }

  playTone(freq: number, durationSec: number, type: OscillatorType = 'sine', gainVal = 0.08): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationSec);
    } catch {
      // Игнорируем ошибки автовоспроизведения
    }
  }

  move(): void {
    this.playTone(260, 0.03, 'triangle', 0.04);
  }

  rotate(): void {
    this.playTone(390, 0.045, 'triangle', 0.05);
    this.vibrate(8);
  }

  drop(): void {
    this.playTone(150, 0.07, 'square', 0.05);
    this.vibrate(15);
  }

  lineClear(count: number): void {
    this.playTone(440 + count * 90, 0.16, 'sawtooth', 0.08);
    this.vibrate([20, 30, 35]);
  }

  impact(): void {
    this.playTone(110, 0.22, 'sawtooth', 0.11);
    this.vibrate([40, 20, 40]);
  }

  collide(): void {
    this.playTone(580, 0.12, 'triangle', 0.07);
    this.vibrate(20);
  }
}

export const sfx = new SoundAndHaptics();
