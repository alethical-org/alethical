/** Finance discovery finds names; it never assigns records to an identity. */
const words = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

function closeWord(left: string, right: string): boolean {
  if (/\p{N}/u.test(left + right) || Math.min(left.length, right.length) < 5) return false;
  const allowance = Math.min(left.length, right.length) >= 7 ? 2 : 1;
  if (Math.abs(left.length - right.length) > allowance) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let beforePrevious = previous;
  for (let i = 1; i <= left.length; i++) {
    const row = [i];
    for (let j = 1; j <= right.length; j++) {
      let distance = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1])
        distance = Math.min(distance, beforePrevious[j - 2] + 1);
      row.push(distance);
    }
    beforePrevious = previous;
    previous = row;
  }
  return previous[right.length] <= allowance;
}

/** 1: direct words in any order; 2: likely whole-word spelling; 0: no match. */
export function nameDiscoveryRank(name: string, query: string): 0 | 1 | 2 {
  if (!query.trim()) return 1;
  const typed = words(query);
  const held = words(name);
  if (!typed.length || !held.length) return 0;
  const direct = (word: string) => held.some((candidate) => candidate.includes(word));
  if (typed.every(direct)) return 1;
  return typed.every((word) => direct(word) || held.some((candidate) => closeWord(word, candidate)))
    ? 2
    : 0;
}
