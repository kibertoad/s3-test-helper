import type { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

export async function readZip(stream: Readable): Promise<string> {
  let readData = ''
  return new Promise((resolve, reject) => {
    stream
      .pipe(createGunzip())
      .on('data', (data) => {
        readData += data
      })
      .on('error', (err) => {
        reject(err)
      })
      .on('end', () => {
        resolve(readData)
      })
      .on('finish', () => {
        resolve(readData)
      })
  })
}
