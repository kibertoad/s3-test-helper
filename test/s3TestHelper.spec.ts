import { S3TestHelper } from '../lib/s3TestHelper'
import type { Logger } from '../lib/s3TestHelper'
import {
  CreateBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { expect } from 'chai'

const s3Client = new S3Client({
  endpoint: 'http://s3.localhost.localstack.cloud:4566',
  region: 'eu-west-1',
  credentials: {
    accessKeyId: 'access',
    secretAccessKey: 'secret',
  },
})

class TestLogger implements Logger {
  public readonly errors: string[] = []
  public readonly logs: string[] = []

  error(msg: string) {
    console.error(msg)
    this.errors.push(msg)
  }
}

describe('s3TestHelper', function () {
  let s3TestHelper: S3TestHelper
  let logger: TestLogger
  beforeEach(function () {
    logger = new TestLogger()
    s3TestHelper = new S3TestHelper(s3Client, {
      concurrentCleanupThreads: 3,
      logger,
    })
  })

  after(function () {
    s3Client.destroy()
  })

  it('helper can be instantiated with default values and use default logger', async function () {
    this.timeout(4000)
    const helper = new S3TestHelper(s3Client)
    await helper.createBucket('abc')
    await helper.createBucket('abc')
    await helper.cleanup()
  })

  it('bucket needs to be specified either on a bucket or in a helper', async function () {
    expect(() =>
      s3TestHelper.registerFileForCleanup({
        key: 'dummy',
      }),
    ).to.throw(/Bucket needs to be specified/)
  })

  it('createBucket cleans up after itself', async function () {
    await s3TestHelper.createBucket('abc')

    const listBucketsCommand = new ListBucketsCommand({})
    const responseListBuckets = await s3Client.send(listBucketsCommand)

    expect(responseListBuckets.Buckets?.length).to.eq(1)
    expect(responseListBuckets.Buckets?.[0].Name).to.eq('abc')

    await s3TestHelper.cleanup()

    const listBucketsCommand2 = new ListBucketsCommand({})
    const responseListBuckets2 = await s3Client.send(listBucketsCommand2)

    expect(responseListBuckets2.Buckets?.length).to.eq(0)
  })

  it('createBucket cleans up after itself even if there are hanging files left', async function () {
    await s3TestHelper.deleteBucket('abd')
    await s3TestHelper.deleteBucket('abcd')
    await s3TestHelper.createBucket('abc')

    const createObjectCommand = new PutObjectCommand({
      Bucket: 'abc',
      Key: 'dummyKey',
      Body: JSON.stringify({ id: 1 }),
    })
    await s3Client.send(createObjectCommand)

    await s3TestHelper.cleanup()

    const listBucketsCommand = new ListBucketsCommand({})
    const responseListBuckets = await s3Client.send(listBucketsCommand)

    expect(responseListBuckets.Buckets?.length).to.eq(0)
  })

  it('files created through helper get cleaned up', async function () {
    await s3TestHelper.createBucket('abcd')
    await s3TestHelper.createFile('abcd', 'dummyKey2', { test: 'id' })
    await s3TestHelper.createFile('abcd', 'dummyKey3', 'abc')

    const filesList = await s3TestHelper.listBucketFiles('abcd')
    expect(filesList.length).to.eq(2)
    expect(filesList[0].Key).to.eq('dummyKey2')
    expect(filesList[1].Key).to.eq('dummyKey3')

    await s3TestHelper.cleanup({
      deleteBuckets: false,
    })

    const bucketsList = await s3TestHelper.listBuckets()
    const filesList2 = await s3TestHelper.listBucketFiles('abcd')
    expect(bucketsList.length).to.eq(1)
    expect(filesList2.length).to.eq(0)

    await s3TestHelper.cleanup({
      deleteBuckets: true,
    })
    const bucketsList2 = await s3TestHelper.listBuckets()
    expect(bucketsList2.length).to.eq(0)
  })

  it('registered files get cleaned up', async function () {
    const createBucketCommand = new CreateBucketCommand({ Bucket: 'abc' })
    try {
      await s3Client.send(createBucketCommand)
    } catch {
      // If bucket already exists, fine
    }

    const createObjectCommand = new PutObjectCommand({
      Bucket: 'abc',
      Key: 'dummyKey',
      Body: JSON.stringify({ id: 1 }),
    })

    await s3Client.send(createObjectCommand)

    const filesList = await s3TestHelper.listBucketFiles('abc')
    expect(filesList.length).to.eq(1)
    expect(filesList[0].Key).to.eq('dummyKey')

    s3TestHelper.registerFileForCleanup({
      bucket: 'abc',
      key: 'dummyKey',
    })
    await s3TestHelper.cleanup()

    const filesList2 = await s3TestHelper.listBucketFiles('abc')
    expect(filesList2.length).to.eq(0)

    await s3TestHelper.deleteBucket('abc')
  })

  it('registered files get cleaned up using helper bucket', async function () {
    const helper = new S3TestHelper(s3Client, { bucket: 'def' })
    const createBucketCommand = new CreateBucketCommand({ Bucket: 'def' })
    try {
      await s3Client.send(createBucketCommand)
    } catch {
      // If bucket already exists, fine
    }

    const createObjectCommand = new PutObjectCommand({
      Bucket: 'def',
      Key: 'dummyKey2',
      Body: JSON.stringify({ id: 1 }),
    })

    await s3Client.send(createObjectCommand)

    const filesList = await helper.listBucketFiles('def')
    expect(filesList.length).to.eq(1)
    expect(filesList[0].Key).to.eq('dummyKey2')

    helper.registerFileForCleanup({
      key: 'dummyKey2',
    })
    await helper.cleanup()

    const filesList2 = await helper.listBucketFiles('def')
    expect(filesList2.length).to.eq(0)

    await helper.deleteBucket('def')
  })

  it('logs errors correctly', async function () {
    await s3TestHelper.createBucket('abc')
    await s3TestHelper.createBucket('abc')

    expect(logger.errors.length).to.eq(1)

    await s3TestHelper.deleteBucket('abc')
    await s3TestHelper.deleteBucket('abc')

    expect(logger.errors.length).to.eq(2)

    await s3TestHelper.createBucket('abc')
    await s3TestHelper.deleteBucket('abc')
    s3TestHelper.registerFileForCleanup({
      bucket: 'abc',
      key: 'dummyKey',
    })

    await s3TestHelper.cleanup()
    expect(logger.errors.length).to.eq(4)
  })

  it('emptying bucket deletes its files', async function () {
    await s3TestHelper.createBucket('abc')
    const createObjectCommand = new PutObjectCommand({
      Bucket: 'abc',
      Key: 'dummyKey',
      Body: JSON.stringify({ id: 1 }),
    })
    const createObjectCommand2 = new PutObjectCommand({
      Bucket: 'abc',
      Key: 'dummyKey2',
      Body: JSON.stringify({ id: 2 }),
    })

    await s3Client.send(createObjectCommand)
    await s3Client.send(createObjectCommand2)

    const filesList = await s3TestHelper.listBucketFiles('abc')
    expect(filesList.length).to.eq(2)

    await s3TestHelper.emptyBucket('abc')

    const filesList2 = await s3TestHelper.listBucketFiles('abc')
    expect(filesList2.length).to.eq(0)

    await s3TestHelper.cleanup()
  })
})
