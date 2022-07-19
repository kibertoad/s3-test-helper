import type { S3Client } from '@aws-sdk/client-s3'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsCommand,
} from '@aws-sdk/client-s3'
import { PromisePool } from '@supercharge/promise-pool'

export type FileDefinition = {
  bucket: string
  key: string
}

export type Logger = {
  error: (msg: string) => void
}

const dummyLogger: Logger = {
  error: () => {},
}

export class S3TestHelper {
  private readonly s3Client: S3Client
  private readonly bucketsToCleanup: Set<string>
  private readonly filesToCleanup: FileDefinition[]
  private readonly concurrentCleanupThreads: number
  private readonly logger: Logger

  constructor(s3Client: S3Client, concurrentCleanupThreads = 5, logger: Logger = dummyLogger) {
    this.s3Client = s3Client
    this.bucketsToCleanup = new Set()
    this.filesToCleanup = []
    this.concurrentCleanupThreads = concurrentCleanupThreads
    this.logger = logger
  }

  async createBucket(bucket: string) {
    const createBucketCommand = new CreateBucketCommand({ Bucket: bucket })
    try {
      await this.s3Client.send(createBucketCommand)
    } catch (err: any) {
      this.logger.error(`Error while creating bucket: ${err.message}`)
    }
    this.bucketsToCleanup.add(bucket)
  }

  async deleteBucket(bucket: string) {
    await this.emptyBucket(bucket)
    const deleteBucketCommand = new DeleteBucketCommand({ Bucket: bucket })
    try {
      await this.s3Client.send(deleteBucketCommand)
    } catch (err: any) {
      this.logger.error(`Error while deleting bucket: ${err.message}`)
    }
  }

  async listBucketFiles(bucket: string) {
    const listFilesCommand = new ListObjectsCommand({ Bucket: bucket })
    const filesList = await this.s3Client.send(listFilesCommand)
    return filesList.Contents ?? []
  }

  async emptyBucket(bucket: string) {
    const listFilesCommand = new ListObjectsCommand({ Bucket: bucket })
    try {
      const filesList = await this.s3Client.send(listFilesCommand)
      const fileEntries = Array.from(filesList.Contents ?? [])

      const promisePool = new PromisePool(fileEntries).withConcurrency(
        this.concurrentCleanupThreads,
      )
      await promisePool.process((file) => {
        const deleteFileCommand = new DeleteObjectCommand({
          Bucket: bucket,
          Key: file.Key,
        })
        return this.s3Client.send(deleteFileCommand)
      })
    } catch {
      //if bucket does not exist, do nothing
    }
  }

  registerFileForCleanup(fileDefinition: FileDefinition) {
    this.filesToCleanup.push(fileDefinition)
  }

  async cleanup() {
    const promisePoolFiles = new PromisePool(this.filesToCleanup).withConcurrency(
      this.concurrentCleanupThreads,
    )
    await promisePoolFiles.process((fileDefinition) => {
      const deleteFileCommand = new DeleteObjectCommand({
        Bucket: fileDefinition.bucket,
        Key: fileDefinition.key,
      })
      return this.s3Client.send(deleteFileCommand).catch((err) => {
        this.logger.error(`Error while deleting file: ${err.message}`)
      })
    })

    const promisePoolBucket = new PromisePool(Array.from(this.bucketsToCleanup)).withConcurrency(
      this.concurrentCleanupThreads,
    )
    await promisePoolBucket.process((bucket) => {
      const deleteBucketCommand = new DeleteBucketCommand({
        Bucket: bucket,
      })
      return this.s3Client.send(deleteBucketCommand).catch((err) => {
        this.logger.error(`Error while deleting bucket: ${err.message}`)
      })
    })
  }
}
