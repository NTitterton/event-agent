import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "../shared/config.js";
import type { RunArtifact } from "../shared/types.js";

export interface ArtifactAccessUrl {
  url: string;
  expiresAt: string;
}

export interface ArtifactUrlSigner {
  sign(artifact: RunArtifact): Promise<ArtifactAccessUrl>;
}

export class S3ArtifactUrlSigner implements ArtifactUrlSigner {
  private readonly client: S3Client;

  constructor(config: AppConfig) {
    this.client = new S3Client(config.awsRegion ? { region: config.awsRegion } : {});
  }

  async sign(artifact: RunArtifact): Promise<ArtifactAccessUrl> {
    const expiresIn = 300;
    const command = new GetObjectCommand({
      Bucket: artifact.bucket,
      Key: artifact.key,
      ResponseContentType: artifact.contentType
    });
    return {
      url: await getSignedUrl(this.client, command, { expiresIn }),
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };
  }
}

export class LocalArtifactUrlSigner implements ArtifactUrlSigner {
  async sign(artifact: RunArtifact): Promise<ArtifactAccessUrl> {
    return {
      url: `s3://${artifact.bucket}/${artifact.key}`,
      expiresAt: new Date(Date.now() + 300000).toISOString()
    };
  }
}
