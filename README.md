# s3-test-helper

[![NPM Version][npm-image]][npm-url]
[![Build Status](https://github.com/kibertoad/s3-test-helper/workflows/ci/badge.svg)](https://github.com/kibertoad/s3-test-helper/actions)
[![Coverage Status](https://coveralls.io/repos/kibertoad/s3-test-helper/badge.svg?branch=main)](https://coveralls.io/r/kibertoad/s3-test-helper?branch=main)

Test utilities for working with S3 within integration tests

## Getting Started

First, install the package and s3 sdk:

```bash
npm i @aws-sdk/client-s3
npm i s3-test-helper --save-dev
```

Then use s3TestHelper for instantiating your buckets and tracking your files:

```ts
import { S3TestHelper } from 's3-test-helper'
import { S3Client } from '@aws-sdk/client-s3'

const s3Client = new S3Client({
  endpoint: 'http://s3.localhost.localstack.cloud:4566',
  region: 'eu-west-1',
  credentials: {
    accessKeyId: 'access',
    secretAccessKey: 'secret',
  },
})

describe('s3TestHelper', function () {
  let s3TestHelper: S3TestHelper
  beforeEach(function () {
    s3TestHelper = new S3TestHelper(s3Client)
  })

  it('helper will delete managed bucket during cleanup', async function () {
    const helper = new S3TestHelper(s3Client)
    await helper.createBucket('abc') // This will be deleted after cleanup

    const createObjectCommand = new PutObjectCommand({
      Bucket: 'abc',
      Key: 'dummyKey',
      Body: JSON.stringify({ id: 1 }),
    })
    await s3Client.send(createObjectCommand)

    s3TestHelper.registerFileForCleanup({
      bucket: 'abc',
      key: 'dummyKey', // This file will be deleted after cleanup
    })

    await helper.cleanup()
  })
})
```

[npm-image]: https://img.shields.io/npm/v/s3-test-helper.svg
[npm-url]: https://npmjs.org/package/s3-test-helper
