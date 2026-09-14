// Preserve Firestore's sub-millisecond precision for stable query cursors.
export class Timestamp {
  constructor(value) {
    this.date = value instanceof Date ? value : new Date(value);
    this.iso = typeof value === 'string' ? value : this.date.toISOString();
  }

  toDate() { return new Date(this.date.getTime()); }
  toISOString() { return this.iso; }
}
