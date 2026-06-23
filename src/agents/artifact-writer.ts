import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ArtifactWriter {
  writeMarkdown(input: { bucket: string; key: string; body: string }): Promise<void>;
}

export class S3ArtifactWriter implements ArtifactWriter {
  private readonly client: S3Client;

  constructor(region?: string) {
    this.client = new S3Client(region ? { region } : {});
  }

  async writeMarkdown(input: { bucket: string; key: string; body: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: "text/markdown; charset=utf-8"
      })
    );
  }
}

export class LocalArtifactWriter implements ArtifactWriter {
  constructor(private readonly root = "tmp/reports") {}

  async writeMarkdown(input: { bucket: string; key: string; body: string }): Promise<void> {
    const path = resolve(this.root, input.bucket, input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body, "utf8");
  }
}
