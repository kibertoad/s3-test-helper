import { Logger, S3TestHelper } from '../lib/s3TestHelper'
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
    s3TestHelper = new S3TestHelper(s3Client, 5, logger)
  })

  it('helper can be instantiated with default values and use default logger', async function () {
    const helper = new S3TestHelper(s3Client)
    await helper.createBucket('abc')
    await helper.createBucket('abc')
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
  })
})
