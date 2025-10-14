// netlify/functions/s3-ping.js
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

exports.handler = async () => {
  const region = "us-east-1";
  
  // Debug: Check what Netlify sees (don't log actual secrets!)
  console.log("Has S3_ACCESS_KEY_ID:", !!process.env.S3_ACCESS_KEY_ID);
  console.log("Has S3_SECRET_ACCESS_KEY:", !!process.env.S3_SECRET_ACCESS_KEY);
  console.log("Key length:", process.env.S3_ACCESS_KEY_ID?.length);
  console.log("First 4 chars:", process.env.S3_ACCESS_KEY_ID?.substring(0, 4));
  
  // Check if credentials exist
  if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    return resp(500, {
      ok: false,
      stage: "config",
      error: { message: "Missing AWS credentials in environment variables" }
    });
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: false,
    useArnRegion: true
  });
  
  const sts = new STSClient({
    region,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  try {
    const ident = await sts.send(new GetCallerIdentityCommand({}));
    
    await s3.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: process.env.CSV_OBJECT_KEY
    }));
    
    return resp(200, { ok: true, account: ident.Account });
  } catch (e) {
    // Get identity for debugging (might fail if credentials are invalid)
    let account = "unknown";
    try {
      const ident = await sts.send(new GetCallerIdentityCommand({}));
      account = ident.Account;
    } catch {}
    
    return resp(500, {
      ok: false,
      stage: "s3",
      account,
      bucket: process.env.S3_BUCKET_NAME,
      key: process.env.CSV_OBJECT_KEY,
      error: { 
        name: e?.name, 
        message: e?.message, 
        code: e?.$metadata?.httpStatusCode 
      }
    });
  }
};

function resp(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}