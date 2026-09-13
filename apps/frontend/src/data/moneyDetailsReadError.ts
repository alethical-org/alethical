export class MoneyDetailsReadError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'MoneyDetailsReadError';
  }
}
