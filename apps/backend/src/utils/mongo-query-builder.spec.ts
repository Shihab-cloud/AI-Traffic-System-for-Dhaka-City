const searchFields = { fields: ['name', 'email'] as string[] | undefined };
jest.mock('./search-registry', () => ({
  getSearchFields: () => searchFields.fields,
}));

import { escapeRegex, MongoQueryBuilder } from './mongo-query-builder';

class DummySchema {}

describe('escapeRegex', () => {
  it('escapes all regex metacharacters', () => {
    expect(escapeRegex('a.b*c+d?')).toBe('a\\.b\\*c\\+d\\?');
    expect(escapeRegex('^start$')).toBe('\\^start\\$');
    expect(escapeRegex('(group)[set]{q}')).toBe('\\(group\\)\\[set\\]\\{q\\}');
    expect(escapeRegex('a|b\\c')).toBe('a\\|b\\\\c');
  });
});

describe('MongoQueryBuilder.build', () => {
  it('casts direct-value equality by type', () => {
    expect(MongoQueryBuilder.build({ active: 'true' })).toEqual({ active: true });
    expect(MongoQueryBuilder.build({ n: '42' })).toEqual({ n: 42 });
    expect(MongoQueryBuilder.build({ n: '-3.5' })).toEqual({ n: -3.5 });
    expect(MongoQueryBuilder.build({ s: 'hello' })).toEqual({ s: 'hello' });
  });

  it('parses an ISO date string to a Date but not a bare year', () => {
    const out = MongoQueryBuilder.build({ createdAt: '2024-01-15' }) as { createdAt: Date };
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(MongoQueryBuilder.build({ y: '2024' })).toEqual({ y: 2024 });
  });

  it('maps comparison + range operators', () => {
    expect(
      MongoQueryBuilder.build({ age: { $greaterThan: '3', $lessThanOrEqualTo: '9' } }),
    ).toEqual({ age: { $gt: 3, $lte: 9 } });
    expect(MongoQueryBuilder.build({ d: { $between: ['1', '10'] } })).toEqual({
      d: { $gt: 1, $lt: 10 },
    });
    expect(MongoQueryBuilder.build({ d: { $betweenInclusive: ['1', '10'] } })).toEqual({
      d: { $gte: 1, $lte: 10 },
    });
  });

  it('escapes regex metacharacters in string operators (injection guard)', () => {
    expect(MongoQueryBuilder.build({ name: { $contains: '.*evil' } })).toEqual({
      name: { $regex: '\\.\\*evil', $options: 'i' },
    });
    expect(MongoQueryBuilder.build({ n: { $startsWith: 'a.b' } })).toEqual({
      n: { $regex: '^a\\.b', $options: 'i' },
    });
    expect(MongoQueryBuilder.build({ n: { $includesStringSensitive: 'a.b' } })).toEqual({
      n: { $regex: 'a\\.b' },
    });
  });

  it('maps array + existence operators', () => {
    expect(MongoQueryBuilder.build({ tags: { $arrIncludes: ['a', 'b'] } })).toEqual({
      tags: { $in: ['a', 'b'] },
    });
    expect(MongoQueryBuilder.build({ email: { $empty: true } })).toEqual({ email: { $eq: null } });
    expect(MongoQueryBuilder.build({ email: { $notEmpty: true } })).toEqual({
      email: { $exists: true, $ne: null },
    });
  });

  it('silently drops unknown operators', () => {
    expect(MongoQueryBuilder.build({ x: { $sqlInject: 1 } })).toEqual({});
  });

  describe('operator-key injection guard (NoSQL injection)', () => {
    it('drops a top-level $where key instead of passing it through', () => {
      expect(MongoQueryBuilder.build({ $where: 'while(true){}' })).toEqual({});
    });

    it('drops other JS-eval / query operators used as field keys', () => {
      expect(MongoQueryBuilder.build({ $expr: { $gt: ['$a', '$b'] } })).toEqual({});
      expect(MongoQueryBuilder.build({ $function: 'x' })).toEqual({});
      expect(MongoQueryBuilder.build({ $or: [{ x: 1 }] })).toEqual({});
    });

    it('drops dotted-path field keys', () => {
      expect(MongoQueryBuilder.build({ 'a.$where': 'x' })).toEqual({});
    });

    it('keeps legitimate fields while dropping an injected one in the same filter', () => {
      expect(MongoQueryBuilder.build({ status: 'ACTIVE', $where: 'x' })).toEqual({
        status: 'ACTIVE',
      });
    });
  });
});

describe('MongoQueryBuilder.buildSearch', () => {
  it('returns {} for a blank term or when no fields are registered', () => {
    expect(MongoQueryBuilder.buildSearch('  ', DummySchema as never)).toEqual({});
    searchFields.fields = undefined;
    expect(MongoQueryBuilder.buildSearch('x', DummySchema as never)).toEqual({});
    searchFields.fields = ['name', 'email'];
  });

  it('builds an escaped $or over registered fields', () => {
    expect(MongoQueryBuilder.buildSearch('a.b', DummySchema as never)).toEqual({
      $or: [
        { name: { $regex: 'a\\.b', $options: 'i' } },
        { email: { $regex: 'a\\.b', $options: 'i' } },
      ],
    });
  });
});
