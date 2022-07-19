import type { S3Client } from '@aws-sdk/client-s3'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsCommand,
} from '@aws-sdk/client-s3'
import { PromisePool } from '@supercharge/promise-pool'

export type FileDefinition = {
  bucket?: string
  key: string
}

export type Logger = {
  error: (msg: string) => void
}

const dummyLogger: Logger = {
  error: () => {},
}

export type S3TestHelperOptions = {
  concurrentCleanupThreads?: number
  logger?: Logger
  bucket?: string
}

export class S3TestHelper {
  private readonly s3Client: S3Client
  private readonly bucketsToCleanup: Set<string>
  private readonly filesToCleanup: FileDefinition[]
  private readonly concurrentCleanupThreads: number
  private readonly logger: Logger
  private readonly bucket?: string

  constructor(s3Client: S3Client, options: S3TestHelperOptions = {}) {
    this.s3Client = s3Client
    this.bucketsToCleanup = new Set()
    this.filesToCleanup = []
    this.concurrentCleanupThreads = options.concurrentCleanupThreads ?? 5
    this.logger = options.logger ?? dummyLogger
    this.bucket = options.bucket ?? undefined
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

      await PromisePool.withConcurrency(this.concurrentCleanupThreads)
        .for(fileEntries)
        .process((file) => {
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
    if (!this.bucket && !fileDefinition.bucket) {
      throw new Error('Bucket needs to be specified either for a file, or for entire helper')
    }

    this.filesToCleanup.push({
      key: fileDefinition.key,
      bucket: fileDefinition.bucket ?? this.bucket,
    })
  }

  async cleanup() {
    await PromisePool.withConcurrency(this.concurrentCleanupThreads)
      .for(this.filesToCleanup)
      .process((fileDefinition) => {
        const deleteFileCommand = new DeleteObjectCommand({
          Bucket: fileDefinition.bucket,
          Key: fileDefinition.key,
        })
        return this.s3Client.send(deleteFileCommand).catch((err) => {
          this.logger.error(`Error while deleting file: ${err.message}`)
        })
      })

    await PromisePool.withConcurrency(this.concurrentCleanupThreads)
      .for(Array.from(this.bucketsToCleanup))
      .process((bucket) => {
        const deleteBucketCommand = new DeleteBucketCommand({
          Bucket: bucket,
        })
        return this.s3Client.send(deleteBucketCommand).catch((err) => {
          this.logger.error(`Error while deleting bucket: ${err.message}`)
        })
      })
  }
}
