import { atHour, addDays, startOfDay, weekdayIndex } from './time';

export interface CartItem {
  start: number;
  end: number;
  seriesKey: string | null;
}

export interface SeriesMeta {
  label: string;
}

const KEY = 'mtf.cart';

interface Persisted {
  items: CartItem[];
  series: Record<string, SeriesMeta>;
  purpose: string;
  driver: string;
  driverId?: number | null;
  vehicleId?: number;
}

function load(): Persisted {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Persisted | null;
    if (raw && Array.isArray(raw.items)) {
      // Vergangene Slots beim Laden aussortieren
      raw.items = raw.items.filter((it) => it.end > Date.now());
      return { items: raw.items, series: raw.series ?? {}, purpose: raw.purpose ?? '', driver: raw.driver ?? '' };
    }
  } catch {
    /* ignorieren */
  }
  return { items: [], series: {}, purpose: '', driver: '' };
}

class Cart {
  items = $state<CartItem[]>([]);
  series = $state<Record<string, SeriesMeta>>({});
  purpose = $state('');
  driver = $state('');
  driverId = $state<number | null>(null);
  /** Der Korb ist immer an genau ein Fahrzeug gebunden. */
  vehicleId = $state(1);

  constructor() {
    const p = load();
    this.items = p.items;
    this.series = p.series;
    this.purpose = p.purpose;
    this.driver = p.driver;
    this.driverId = p.driverId ?? null;
    this.vehicleId = p.vehicleId ?? 1;
  }

  private save(): void {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        items: this.items,
        series: this.series,
        purpose: this.purpose,
        driver: this.driver,
        driverId: this.driverId,
        vehicleId: this.vehicleId,
      })
    );
  }

  /** Bindet den Korb ans Fahrzeug; bei nicht-leerem Korb mit anderem Fahrzeug → false. */
  bindVehicle(vehicleId: number): boolean {
    if (this.items.length === 0) {
      this.vehicleId = vehicleId;
      return true;
    }
    return this.vehicleId === vehicleId;
  }

  saveFields(): void {
    this.save();
  }

  warning = $state<string | null>(null);

  /** Belegt der Warenkorb die volle Stunde, die bei `day`/`hour` beginnt? */
  has(day: Date, hour: number): CartItem | undefined {
    const t = atHour(day, hour).getTime();
    return this.items.find((it) => it.start <= t && it.end > t);
  }

  toggleHour(day: Date, hour: number, vehicleId: number = this.vehicleId): void {
    if (!this.bindVehicle(vehicleId)) {
      this.warning = 'Der Warenkorb enthält schon Termine für ein anderes Fahrzeug – erst buchen oder leeren.';
      return;
    }
    this.warning = null;
    const start = atHour(day, hour).getTime();
    const end = atHour(day, hour + 1).getTime();
    const existing = this.items.findIndex((it) => it.seriesKey === null && it.start === start && it.end === end);
    if (existing >= 0) {
      this.items.splice(existing, 1);
    } else {
      const covering = this.items.findIndex((it) => it.start <= start && it.end >= end);
      if (covering >= 0) {
        this.items.splice(covering, 1);
      } else {
        this.items.push({ start, end, seriesKey: null });
      }
    }
    this.save();
  }

  addSeries(opts: {
    weekdays: boolean[];
    from: Date;
    to: Date;
    startHour: number;
    endHour: number;
    label: string;
    vehicleId?: number;
  }): number {
    if (!this.bindVehicle(opts.vehicleId ?? this.vehicleId)) {
      this.warning = 'Der Warenkorb enthält schon Termine für ein anderes Fahrzeug – erst buchen oder leeren.';
      return 0;
    }
    this.warning = null;
    const key = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    let count = 0;
    let day = startOfDay(opts.from);
    const last = startOfDay(opts.to).getTime();
    while (day.getTime() <= last) {
      if (opts.weekdays[weekdayIndex(day)]) {
        const start = atHour(day, opts.startHour).getTime();
        const end = atHour(day, opts.endHour).getTime();
        if (end > Date.now() && !this.items.some((it) => it.start < end && start < it.end)) {
          this.items.push({ start, end, seriesKey: key });
          count++;
        }
      }
      day = addDays(day, 1);
    }
    if (count > 0) {
      this.series[key] = { label: opts.label };
      this.save();
    }
    return count;
  }

  /**
   * Entfernt einen (ggf. zusammengeführten) Termin: alle gespeicherten
   * Einzelstunden, die vollständig im übergebenen Zeitraum liegen.
   */
  removeItem(item: CartItem): void {
    const before = this.items.length;
    this.items = this.items.filter(
      (it) => !(it.seriesKey === item.seriesKey && it.start >= item.start && it.end <= item.end)
    );
    if (item.seriesKey && !this.items.some((it) => it.seriesKey === item.seriesKey)) {
      delete this.series[item.seriesKey];
    }
    if (this.items.length !== before) this.save();
  }

  /**
   * Ersetzt einen (ggf. zusammengeführten) Einzeltermin durch einen neuen Zeitraum.
   * Andere Einzelstunden, die sich mit dem neuen Zeitraum überschneiden, werden absorbiert.
   */
  updateItem(item: CartItem, start: number, end: number): void {
    if (item.seriesKey !== null || end <= start) return;
    this.items = this.items.filter(
      (it) =>
        it.seriesKey !== null ||
        !((it.start >= item.start && it.end <= item.end) || (it.start < end && start < it.end))
    );
    this.items.push({ start, end, seriesKey: null });
    this.save();
  }

  removeSeries(key: string): void {
    this.items = this.items.filter((it) => it.seriesKey !== key);
    delete this.series[key];
    this.save();
  }

  clear(): void {
    this.items = [];
    this.series = {};
    this.purpose = '';
    this.driver = '';
    this.driverId = null;
    this.vehicleId = 1;
    this.save();
  }

  /**
   * Einzelne, direkt aneinandergrenzende Stunden-Slots (ohne Serie) zu
   * zusammenhängenden Terminen verschmelzen – so wird aus 18+19 Uhr ein
   * Termin 18–20 Uhr.
   */
  get merged(): CartItem[] {
    const singles = this.items
      .filter((it) => it.seriesKey === null)
      .slice()
      .sort((a, b) => a.start - b.start);
    const out: CartItem[] = [];
    for (const it of singles) {
      const prev = out[out.length - 1];
      if (prev && prev.end === it.start) {
        prev.end = it.end;
      } else {
        out.push({ ...it });
      }
    }
    const seriesItems = this.items.filter((it) => it.seriesKey !== null).slice().sort((a, b) => a.start - b.start);
    return [...out, ...seriesItems];
  }

  get count(): number {
    return this.merged.length;
  }
}

export const cart = new Cart();
