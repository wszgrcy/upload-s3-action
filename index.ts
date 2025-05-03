import * as core from '@actions/core';
import S3 from 'aws-sdk/clients/s3';
import * as fs from 'fs';
import * as path from 'path';
import shortid from 'shortid';
import { default as slash } from 'slash';
import klawSync from 'klaw-sync';
import { lookup } from 'mime-types';

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
const paths = klawSync(SOURCE_DIR, { nodir: true });

function upload(params: S3.Types.PutObjectRequest): Promise<string> {
  return new Promise((resolve) => {
    s3.upload(params, (err, data) => {
      if (err) core.error(err);
      core.info(`uploaded - ${data.Key}`);
      core.info(`located - ${data.Location}`);
      resolve(data.Location);
    });
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
    core.info('上传');
    const sourceDir: string = slash(path.join(process.cwd(), SOURCE_DIR));
    const uploadPromises = paths.map((p) => {
      const fileStream = fs.createReadStream(p.path);
      const bucketPath = slash(
        path.join(destinationDir, slash(path.relative(sourceDir, p.path)))
      );
      const params: S3.Types.PutObjectRequest = {
        Bucket: BUCKET,
        ACL: 'public-read',
        Body: fileStream,
        Key: bucketPath,
        ContentType: lookup(p.path) || 'text/plain',
      };
      return upload(params);
    });

    let locations = await Promise.all(uploadPromises);
    core.info(`object key - ${destinationDir}`);
    core.info(`object locations - ${locations}`);
    core.setOutput('object_key', destinationDir);
    core.setOutput('object_locations', locations);
  } else if (MODE === 'download') {
    core.info('下载');
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
  }else{
    core.error('模式错误,只能为下载或上传')
  }
}

run().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
