const { S3Client } = require("@aws-sdk/client-s3");

function getS3() {
  const region = process.env.AWS_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT || undefined;   // leave unset for AWS S3
  const forcePathStyle = !!process.env.S3_FORCE_PATH_STYLE; // only for R2

  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: (accessKeyId && secretAccessKey)
      ? { accessKeyId, secretAccessKey }
      : undefined,
  });
}

module.exports = { getS3 }; // exact name
