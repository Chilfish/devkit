import { describe, expect, it } from 'vitest'
import {
  isLocalMode,
  isLocalUrl,
  localBucket,
  localEndpoint,
  localPublicBase,
  parseDatabaseInfo,
  parseEnvContent,
  upsertEnvValues,
} from '../../src/shared/index'

describe('isLocalUrl', () => {
  it.each([
    'postgres://postgres@localhost:5432/app',
    'postgres://postgres@127.0.0.1:5432/app',
    'http://[::1]:4444/sql',
    'http://localhost',
  ])('accepts %s', (url) => {
    expect(isLocalUrl(url)).toBe(true)
  })

  it.each([
    'postgres://user@db.example.com/app',
    'http://127.0.0.1.nip.io:4444/sql',
    'http://localhost.example.com',
    '',
    'not a url',
    undefined,
    null,
  ])('rejects %s', (url) => {
    expect(isLocalUrl(url)).toBe(false)
  })
})

describe('isLocalMode', () => {
  it.each(['1', 'true', 'YES', '  True  '])('accepts %s', (value) => {
    expect(isLocalMode({ LOCAL: value })).toBe(true)
  })

  it.each(['0', 'false', 'no', '', undefined])('rejects %s', (value) => {
    expect(isLocalMode({ LOCAL: value })).toBe(false)
  })

  it('honors a custom flag name', () => {
    expect(isLocalMode({ IS_LOCAL: '1', LOCAL: '0' }, 'IS_LOCAL')).toBe(true)
  })
})

describe('parseEnvContent', () => {
  it('ignores comments and blank lines and trims values', () => {
    expect(parseEnvContent('# comment\n\nA = 1 \nB=hello world\n')).toEqual({ A: '1', B: 'hello world' })
  })

  it('splits on the first equals only', () => {
    expect(parseEnvContent('DATABASE_URL=postgres://x?a=b')).toEqual({ DATABASE_URL: 'postgres://x?a=b' })
  })

  it('strips matching quotes', () => {
    expect(parseEnvContent('A="quoted"\nB=\'single\'\nC="mismatch\''))
      .toEqual({ A: 'quoted', B: 'single', C: '"mismatch\'' })
  })

  it('skips lines without a key', () => {
    expect(parseEnvContent('=value\nKEY=value')).toEqual({ KEY: 'value' })
  })
})

describe('upsertEnvValues', () => {
  it('overwrites existing keys and preserves everything else', () => {
    const content = '# header\nDATABASE_URL=old\nLOCAL=0\nDATABASE_URL_ONLINE=remote\n\nOTHER=keep\n'
    expect(upsertEnvValues(content, { DATABASE_URL: 'new', LOCAL: '1' })).toBe(
      '# header\nDATABASE_URL=new\nLOCAL=1\nDATABASE_URL_ONLINE=remote\n\nOTHER=keep\n',
    )
  })

  it('appends missing keys', () => {
    expect(upsertEnvValues('A=1\n', { B: '2' })).toBe('A=1\nB=2\n')
  })

  it('normalizes trailing newlines', () => {
    expect(upsertEnvValues('A=1\n\n\n', { A: '2' })).toBe('A=2\n')
  })
})

describe('local address helpers', () => {
  it('derives the public base with path style', () => {
    expect(localPublicBase('http://127.0.0.1:9000/', 'bucket')).toBe('http://127.0.0.1:9000/bucket')
  })

  it('reads the endpoint with the documented precedence', () => {
    expect(localEndpoint({ S3_ENDPOINT: 'http://127.0.0.1:9100/' })).toBe('http://127.0.0.1:9100')
    expect(localEndpoint({ MINIO_ENDPOINT: 'http://127.0.0.1:9200' })).toBe('http://127.0.0.1:9200')
    expect(localEndpoint({})).toBe('http://127.0.0.1:9000')
  })

  it('reads the bucket with the documented precedence', () => {
    expect(localBucket({ R2_BUCKET: 'from-env' }, 'from-config')).toBe('from-env')
    expect(localBucket({}, 'from-config')).toBe('from-config')
    expect(localBucket({})).toBe('devkit-local')
  })
})

describe('parseDatabaseInfo', () => {
  it('returns host, port and database', () => {
    expect(parseDatabaseInfo('postgres://user:pass@localhost:5432/app')).toEqual({
      host: 'localhost:5432',
      database: 'app',
    })
  })

  it('returns null for unusable values', () => {
    expect(parseDatabaseInfo(undefined)).toBeNull()
    expect(parseDatabaseInfo('nope')).toBeNull()
  })
})
