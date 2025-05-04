import * as core from '@actions/core';
import S3 from 'aws-sdk/clients/s3';
import * as fs from 'fs';
import * as path from 'path';
import shortid from 'shortid';
import { default as slash } from 'slash';
import { sync } from 'fast-glob';
const isDEV = process.env['RUN_DEV'] === 'true';
const AWS_KEY_ID = isDEV
  ? process.env['AWS_KEY_ID']!
  : core.getInput('aws_key_id', { required: true });
const SECRET_ACCESS_KEY: string = isDEV
  ? process.env['SECRET_ACCESS_KEY']!
  : core.getInput('aws_secret_access_key', {
      required: true,
    });
const BUCKET: string = isDEV
  ? process.env['BUCKET']!
  : core.getInput('aws_bucket', { required: true });
const SOURCE_DIR: string = isDEV
  ? process.env['SOURCE_DIR']!
  : core.getInput('source_dir', { required: true });
const SOURCE_IGNORE = isDEV
  ? process.env['SOURCE_IGNORE']?.split(',')
  : core.getMultilineInput('source_ignore', { required: false });
const DESTINATION_DIR: string =
  (isDEV
    ? process.env['DESTINATION_DIR']!
    : core.getInput('destination_dir', { required: false })) ?? '';
const ENDPOINT: string =
  (isDEV
    ? process.env['ENDPOINT']!
    : core.getInput('endpoint', { required: false })) ?? '';
const MODE: string =
  (isDEV ? process.env['MODE']! : core.getInput('mode', { required: false })) ??
  '';

const s3options: S3.Types.ClientConfiguration = {
  accessKeyId: AWS_KEY_ID,
  secretAccessKey: SECRET_ACCESS_KEY,
};

if (ENDPOINT) {
  s3options.endpoint = ENDPOINT;
}

const s3: S3 = new S3(s3options);
const destinationDir =
  DESTINATION_DIR === '/' ? shortid.generate() : DESTINATION_DIR;

function upload(filePath: string, params: S3.Types.PutObjectRequest) {
  const fileStream = fs.createReadStream(filePath);
  return s3
    .upload({ ...params, Body: fileStream })
    .promise()
    .then((data) => {
      core.info(`✅ ${filePath} => ${data.Key}`);
      core.info(`🔗 ${data.Location}`);
      return data;
    });
}
function download(params: S3.Types.GetObjectRequest) {
  let outputFilePath = path.join(process.cwd(), destinationDir, params.Key);
  fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
  let wStream = fs.createWriteStream(
    path.join(process.cwd(), destinationDir, params.Key)
  );
  s3.getObject(params).createReadStream().pipe(wStream);
  return new Promise<void>((resolve) => {
    wStream.once('finish', () => {
      core.info(`✅ ${params.Key} => ${outputFilePath}`);
      resolve();
    });
    wStream.once('error', (err) => {
      core.error(err);
    });
  });
}

async function run() {
  if (MODE === 'upload') {
    let { fileTypeFromFile } = await import('file-type');
    core.info('⏫');
    const paths = sync(SOURCE_DIR, {
      ignore: SOURCE_IGNORE,
      cwd: process.cwd(),
    });
    const uploadPromises = paths.map(async (relPath) => {
      let absPath = path.join(process.cwd(), relPath);
      const bucketPath = slash(path.join(destinationDir, relPath));

      const params: S3.Types.PutObjectRequest = {
        Bucket: BUCKET,
        ACL: 'public-read',
        Key: bucketPath,
        ContentType: (await fileTypeFromFile(absPath))?.mime || 'text/plain',
      };
      return upload(absPath, params);
    });

    let result = await Promise.all(uploadPromises);

    core.setOutput('object_key', destinationDir);
    core.setOutput('object_result', result);
  } else if (MODE === 'download') {
    core.info('⏬');
    let list = await s3
      .listObjectsV2({
        Bucket: BUCKET,
        Prefix: SOURCE_DIR,
      })
      .promise();
    core.info(JSON.stringify(list));
    for (const item of list.Contents!) {
      await download({ Bucket: BUCKET, Key: item.Key! });
    }
  } else {
    core.error(`☑️upload ☑️download ❌${MODE}`);
  }
}

run().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
