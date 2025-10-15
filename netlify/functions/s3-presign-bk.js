const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

exports.handler = async () => {
  try {
    const Bucket = process.env.S3_BUCKET_NAME;
    const Key = process.env.CSV_OBJECT_KEY;
    const cmd = new GetObjectCommand({
      Bucket, Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 });
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
};
