/**
 * Детерминированный генератор псевдослучайных чисел (Mulberry32).
 * Позволяет сохранять и восстанавливать состояние (state) для полного детерминизма.
 */
export class SeededRng {
  public state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /** Возвращает число с плавающей точкой в диапазоне [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.state = this.state >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Возвращает целое число в диапазоне [min, max] включительно */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Детерминированное перемешивание массива (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  clone(): SeededRng {
    const cloned = new SeededRng(1);
    cloned.state = this.state;
    return cloned;
  }
}
