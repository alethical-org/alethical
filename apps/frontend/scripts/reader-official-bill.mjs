/** Public bill identity only. Never return query strings or unknown values. */
export function officialBillIdentity(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.origin !== 'https://www.revisor.mn.gov' || url.username || url.password) return null;
  const canonical = url.pathname.match(
    /^\/bills\/(\d{2,3})\/(20\d{2})\/(\d{1,2})\/(HF|SF)\/(\d+)\/(?:versions\/[^/]+\/?)?$/,
  );
  if (canonical && Number(canonical[5]) > 0)
    return {
      legislature: Number(canonical[1]),
      year: Number(canonical[2]),
      session: Number(canonical[3]),
      chamber: canonical[4],
      number: Number(canonical[5]),
    };
  if (url.pathname !== '/bills/bill.php') return null;
  for (const key of ['f', 'y', 'ssn', 'b'])
    if (url.searchParams.getAll(key).length > 1) return null;
  const file = url.searchParams.get('f')?.match(/^(HF|SF)(\d+)$/);
  const year = url.searchParams.get('y');
  const session = url.searchParams.get('ssn');
  const branch = url.searchParams.get('b');
  if (
    !file ||
    Number(file[2]) <= 0 ||
    !/^20\d{2}$/.test(year ?? '') ||
    !/^\d{1,2}$/.test(session ?? '') ||
    (branch && branch !== (file[1] === 'HF' ? 'House' : 'Senate'))
  )
    return null;
  return {
    legislature: null,
    year: Number(year),
    session: Number(session),
    chamber: file[1],
    number: Number(file[2]),
  };
}

export function sameOfficialBill(expected, actual) {
  return (
    !!expected &&
    !!actual &&
    ['year', 'session', 'chamber', 'number'].every((key) => expected[key] === actual[key]) &&
    (expected.legislature === null ||
      actual.legislature === null ||
      expected.legislature === actual.legislature)
  );
}

export function selectedBillMatchesOfficialLink(path, official) {
  const selected = path.match(/^\/bills\/(\d{2,3})-(20\d{2})-(HF|SF)(\d+)$/);
  return (
    !!selected &&
    !!official &&
    Number(selected[2]) === official.year &&
    selected[3] === official.chamber &&
    Number(selected[4]) === official.number &&
    (official.legislature === null || Number(selected[1]) === official.legislature)
  );
}
