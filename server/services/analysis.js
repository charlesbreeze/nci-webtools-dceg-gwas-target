import fs from "fs";
import os from "os";
import path from "path";
import AWS from "aws-sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { promisify } from "util";
import { execFile } from "child_process";
const { INPUT_FOLDER, OUTPUT_FOLDER, MAGMA, DATA_BUCKET } = process.env;
const execFileAsync = promisify(execFile);

export async function runMagmaAnalysis(params, logger) {
  const s3 = new S3Client();
  const id = params.request_id;
  const inputDir = path.resolve(INPUT_FOLDER, id);
  const resultDir = path.resolve(OUTPUT_FOLDER, id);
  await mkdirs([inputDir, resultDir]);
  let results = {};

  if (params.snpType.value !== "custom") {
    const filepath = path.resolve(inputDir, `${params.snpLocFile}`);
    logger.info(`SNP Loc File: ${filepath}`);

    //Donwload results if they do no exist
    if (!fs.existsSync(filepath)) {
      const s3Key = `gwastarget/${params.snpType.value}/${params.snpLocFile}`;
      logger.info(`[${id}] Downloading SNP Loc file: ${s3Key}`);
      await downloadS3File(s3, DATA_BUCKET, s3Key, filepath);
      logger.info(`[${id}] Finished downloading SNP Loc file`);
    }
  }

  //Download sample gene location file
  if (params.geneLocFile === "sample_gene_loc.loc") {
    const filepath = path.resolve(inputDir, "sample_gene_loc.loc");
    const s3Key = "gwastarget/gene_analysis.genes.loc";
    logger.info(`[${id}] Download Gene Location file`);
    await downloadS3File(s3, DATA_BUCKET, s3Key, filepath);
    logger.info(`[${id}] Finished downloading Gene Location file`);
  }

  // run annotation
  results.annotation = await runAnnotation({
    snpLocFile: path.resolve(inputDir, params.snpLocFile),
    geneLocFile: path.resolve(inputDir, params.geneLocFile),
    outFile: path.resolve(resultDir, "annotation"),
  });
  logger.info(`[${id}] Finished /annotation`);

  //Download sample P-Value File
  if (params.pvalFile === "sample_snp.tsv") {
    const filepath = path.resolve(inputDir, "sample_snp.tsv");
    const s3Key = `gwastarget/sample_snp.tsv`;
    logger.info(`[${id}] Downloading P-Value file: ${s3Key}`);
    await downloadS3File(s3, DATA_BUCKET, s3Key, filepath);
    logger.info(`[${id}] Finished downloading P-Value file`);
  }

  //Download bim file if user did not upload
  if (!params.geneAnalysisBim) {
    const filepath = path.resolve(inputDir, `${id}.bim`);
    const s3Key = `gwastarget/${params.snpType.value}/${params.snpType.value}.bim`;
    logger.info(`[${id}] Download .bim file: ${s3Key}`);
    await downloadS3File(s3, DATA_BUCKET, s3Key, filepath);
    logger.info(`[${id}] Finished downloading .bim file`);
  }

  //Download bed file if user did not upload
  if (!params.geneAnalysisBed) {
    const filepath = path.resolve(inputDir, `${id}.bed`);
    const s3Key = `gwastarget/${params.snpType.value}/${params.snpType.value}.bed`;
    logger.info(`[${id}] Download .bed file: ${s3Key}`);
    await downloadS3File(s3, DATA_BUCKET, s3Key, filepath);
    logger.info(`[${id}] Finished downloading .bed file`);
  }

  //Download fam file if user did not upload
  if (!params.geneAnalysisFam) {
    const filepath = path.resolve(inputDir, `${id}.fam`);
    const s3Key = `gwastarget/${params.snpType.value}/${params.snpType.value}.fam`;
    logger.info(`[${id}] Download .fam file`);
    await downloadS3File(s3, DATA_BUCKET, s3Key, filepath);
    logger.info(`[${id}] Finished downloading .fam file`);
  }

  // common gene analysis parameters
  let geneAnalysisParams = {
    bFile: path.resolve(inputDir, id),
    geneAnnotFile: path.resolve(resultDir, "annotation.genes.annot"),
    genesOnly: !(params.geneSetFile && params.covarFile),
    outFile: path.resolve(resultDir, "gene_analysis"),
  };

  if (params.analysisInput.value !== "rawData") {
    const sampleSizeKey = params.sampleSizeOption.value === "input" ? "N" : "ncol";
    geneAnalysisParams.pvalFile = path.resolve(inputDir, params.pvalFile);
    geneAnalysisParams.sampleSize = `${sampleSizeKey}=${params.sampleSize}`;
  }

  // run raw gene analysis
  logger.info(`[${id}] Run gene analysis`);
  results.geneAnalysis = await runGeneAnalysis(geneAnalysisParams);
  logger.info(`[${id}] Finish gene analysis`);

  return results;
}

export async function runMagma(params, logger) {
  logger.info(`[${params.request_id}] Run annotation`);
  const platform = os.platform();
  const s3 = new AWS.S3();
  logger.debug(params);
  const exec = {
    win32: path.resolve(MAGMA, "magma_win.exe"),
    linux: "magma",
    darwin: "magma_mac",
  }[platform];

  const inputDir = path.resolve(INPUT_FOLDER, params.request_id);
  const resultDir = path.resolve(OUTPUT_FOLDER, params.request_id);
  await mkdirs([inputDir, resultDir]);

  //Download preset SNP Location files
  if (params.snpType.value !== "custom") {
    const filepath = path.resolve(inputDir, `${params.snpLocFile}`);
    logger.info(filepath);

    //Donwload results if they do no exist
    if (!fs.existsSync(filepath)) {
      logger.info(`[${params.request_id}] Download SNP Loc file`);
      const object = await s3
        .getObject({
          Bucket: DATA_BUCKET,
          Key: `gwastarget/${params.snpType.value}/${params.snpLocFile}`,
        })
        .promise();

      await fs.promises.writeFile(filepath, object.Body);
      logger.info(`[${params.request_id}] Finished downloading SNP Loc file`);
    }
  }

  //Download sample gene location file
  if (params.geneLocFile === "sample_gene_loc.loc") {
    const filepath = path.resolve(inputDir, "sample_gene_loc.loc");

    logger.info(`[${params.request_id}] Download Gene Location file`);
    const object = await s3
      .getObject({
        Bucket: DATA_BUCKET,
        Key: `gwastarget/sample_gene_loc.loc`,
      })
      .promise();

    await fs.promises.writeFile(filepath, object.Body);
    logger.info(`[${params.request_id}] Finished downloading Gene Location file`);
  }

  //Run annotation
  var args = [
    "--annotate",
    "--snp-loc",
    path.resolve(inputDir, params.snpLocFile),
    "--gene-loc",
    path.resolve(inputDir, params.geneLocFile),
    "--out",
    path.resolve(resultDir, "annotation"),
  ];

  logger.info(args);

  await execFileAsync(exec, args);

  logger.info(`[${params.request_id}] Finished /annotation`);
  let geneAnalysis;

  //Download sample P-Value File
  if (params.pvalFile === "sample_snp.tsv") {
    const filepath = path.resolve(inputDir, "sample_snp.tsv");

    logger.info(`[${params.request_id}] Download P-Value file`);
    const object = await s3
      .getObject({
        Bucket: DATA_BUCKET,
        Key: `gwastarget/sample_snp.tsv`,
      })
      .promise();

    await fs.promises.writeFile(filepath, object.Body);
    logger.info(`[${params.request_id}] Finished downloading P-Value file`);
  }

  //Download bim file if user did not upload
  if (!params.geneAnalysisBim) {
    const filepath = path.resolve(inputDir, `${params.request_id}.bim`);
    logger.info(`[${params.request_id}] Download .bim file`);

    const object = await s3
      .getObject({
        Bucket: DATA_BUCKET,
        Key: `gwastarget/${params.snpType.value}/${params.snpType.value}.bim`,
      })
      .promise();

    await fs.promises.writeFile(filepath, object.Body);
    logger.info(`[${params.request_id}] Finished downloading .bim file`);
  }

  //Download bed file if user did not upload
  if (!params.geneAnalysisBed) {
    const filepath = path.resolve(inputDir, `${params.request_id}.bed`);
    logger.info(`[${params.request_id}] Download .bed file`);

    const object = await s3
      .getObject({
        Bucket: DATA_BUCKET,
        Key: `gwastarget/${params.snpType.value}/${params.snpType.value}.bed`,
      })
      .promise();

    await fs.promises.writeFile(filepath, object.Body);
    logger.info(`[${params.request_id}] Finished downloading .bed file`);
  }

  //Download fam file if user did not upload
  if (!params.geneAnalysisFam) {
    const filepath = path.resolve(inputDir, `${params.request_id}.fam`);
    logger.info(`[${params.request_id}] Download .fam file`);

    const object = await s3
      .getObject({
        Bucket: DATA_BUCKET,
        Key: `gwastarget/${params.snpType.value}/${params.snpType.value}.fam`,
      })
      .promise();

    await fs.promises.writeFile(filepath, object.Body);
    logger.info(`[${params.request_id}] Finished downloading .fam file`);
  }

  //Run raw gene analysis
  if (params.analysisInput.value === "rawData") {
    geneAnalysis = [
      "--bfile",
      path.resolve(inputDir, params.request_id),
      "--gene-annot",
      path.resolve(resultDir, "annotation.genes.annot"),
      params.geneSetFile && params.covarFile ? "" : "--genes-only",
      "--out",
      path.resolve(resultDir, "gene_analysis"),
    ];
  }
  //Run reference gene analysis
  else {
    var sampleSizeParam;
    if (params.sampleSizeOption.value === "input") sampleSizeParam = "N=";
    else sampleSizeParam = "ncol=";
    geneAnalysis = [
      "--bfile",
      path.resolve(inputDir, params.request_id),
      "--pval",
      path.resolve(inputDir, params.pvalFile),
      `${sampleSizeParam}${params.sampleSize}`,
      "--gene-annot",
      path.resolve(resultDir, "annotation.genes.annot"),
      params.geneSetFile && params.covarFile ? "" : "--genes-only",
      "--out",
      path.resolve(resultDir, "gene_analysis"),
    ];
  }

  logger.info(geneAnalysis);

  logger.info(`[${params.request_id}] Run gene analysis`);
  await execFileAsync(exec, geneAnalysis);
  logger.info(`[${params.request_id}] Finish gene analysis`);
}

/**
 * Utility Functions
 * TODO: Move to a separate file
 */

export async function magma(...args) {
  const platform = os.platform();
  const exec = {
    win32: path.resolve(MAGMA, "magma_win.exe"),
    linux: "magma",
    darwin: "magma_mac",
  }[platform];
  if (!exec) throw new Error(`Unsupported platform: ${platform}`);
  return await execFileAsync(exec, args.flat().filter(Boolean));
}

export async function downloadS3File(s3, bucket, key, filepath) {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  await writeStreamToFile(response.Body, filepath);
}

function writeStreamToFile(stream, filepath) {
  return new Promise((resolve, reject) => {
    stream
      .pipe(fs.createWriteStream(filepath))
      .on("error", (err) => reject(err))
      .on("close", () => resolve());
  });
}

export async function mkdirs(dirs) {
  for (const dir of dirs) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

export async function runAnnotation({ snpLocFile, geneLocFile, outFile }) {
  return await magma("--annotate", "--snp-loc", snpLocFile, "--gene-loc", geneLocFile, "--out", outFile);
}

export async function runGeneAnalysis({ bFile, pvalFile, sampleSize, geneAnnotFile, genesOnly, outFile }) {
  return await magma(
    "--bfile",
    bFile,
    pvalFile && sampleSize && ["--pval-file", pvalFile, sampleSize],
    "--gene-annot",
    geneAnnotFile,
    genesOnly && "--genes-only",
    "--out",
    outFile
  );
}
