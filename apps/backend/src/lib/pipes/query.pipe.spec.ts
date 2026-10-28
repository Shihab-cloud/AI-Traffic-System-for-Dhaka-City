import { QueryTransformPipe } from './query.pipe';

const pipe = new QueryTransformPipe();

function run(query: Record<string, unknown>) {
  return pipe.transform(query);
}

describe('QueryTransformPipe sort', () => {
  it('defaults to newest first', () => {
    expect(run({}).sortBy).toEqual({ createdAt: -1 });
  });

  it('reads direction from the parsed value', () => {
    expect(run({ sortBy: 'name=desc' }).sortBy).toEqual({ name: -1 });
    expect(run({ sortBy: 'name=asc' }).sortBy).toEqual({ name: 1 });
  });

  it('accepts a dotted path', () => {
    expect(run({ sortBy: 'role.rank=asc' }).sortBy).toEqual({ 'role.rank': 1 });
  });

  it('drops an operator-shaped key rather than handing it to $sort', () => {
    expect(run({ sortBy: '$where=desc' }).sortBy).toEqual({ createdAt: -1 });
  });

  it('keeps the valid half of a mixed list', () => {
    expect(run({ sortBy: ['$where=desc', 'name=asc'] }).sortBy).toEqual({ name: 1 });
  });
});

describe('QueryTransformPipe limit', () => {
  it('clamps an oversized page size', () => {
    expect(run({ limit: 1_000_000 }).limit).toBe(200);
  });

  it('falls back to the default for a non-positive value', () => {
    expect(run({ limit: 0 }).limit).toBe(run({}).limit);
  });
});
