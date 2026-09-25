// Set EVAL_MODE BEFORE importing graph nodes to prevent DB persistence during evaluation
process.env.EVAL_MODE = 'true';

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs';
import path from 'node:path';
import { runKitGraph } from './graph/graph';
import { checkCoverage } from './services/kit/checkCoverage';
import type { AppendixAKit } from './types/kit';

// ── Appendix B Types ─────────────────────────────────────────────────────────

export interface AppendixBBatchInputCase {
  id?: string;
  jd: string;
  company_url?: string;
  companyUrl?: string;
  days: number;
}

export interface AppendixBKitSuccessResult {
  id: string;
  status: 'ok';
  kit: AppendixAKit;
  error: null;
}

export interface AppendixBKitFailureResult {
  id: string;
  status: 'failed';
  kit: null;
  error: {
    code: string;
    message: string;
  };
}

export type AppendixBKitResult = AppendixBKitSuccessResult | AppendixBKitFailureResult;

export interface AppendixBBatchOutput {
  version: string;
  generated_at: string;
  kits: AppendixBKitResult[];
}

const DEFAULT_SAMPLE_CASES: AppendixBBatchInputCase[] = [
  {
    id: 'case-01',
    company_url: 'https://www.gevernova.com/',
    days: 5,
    jd: `Senior Full Stack Engineer\n\nWe are looking for a Senior Full Stack Engineer with 5+ years of experience in React, TypeScript, Node.js, and MongoDB.\n\nRequirements:\n- Must have 5+ years of experience in TypeScript and Node.js\n- Must have experience with React and modern CSS\n- Must have experience with MongoDB and distributed system design\n- Must have experience with Docker and CI/CD pipelines`,
  },
  {
    id: 'case-02',
    company_url: 'https://stripe.com/',
    days: 7,
    jd: `Backend Infrastructure Engineer\n\nStripe builds financial infrastructure for the internet. We are seeking a Staff Infrastructure Engineer to design scalable distributed storage and low-latency API gateways.\n\nRequirements:\n- Must have deep expertise in Go, Java, or C++\n- Must have 7+ years of experience operating distributed databases (PostgreSQL, Cassandra, Spanner)\n- Must have experience with Kubernetes and cloud infrastructure`,
  },
];

function parseCliArgs(): { inputPath: string; outputPath: string } {
  const args = process.argv.slice(2);
  let inputPath = path.resolve(process.cwd(), 'cases.json');
  let outputPath = path.resolve(process.cwd(), 'kits.json');

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--input' || arg === '-i') && args[i + 1]) {
      inputPath = path.resolve(process.cwd(), args[i + 1]!);
      i++;
    } else if ((arg === '--output' || arg === '-o') && args[i + 1]) {
      outputPath = path.resolve(process.cwd(), args[i + 1]!);
      i++;
    }
  }

  return { inputPath, outputPath };
}

async function runEvaluation() {
  const { inputPath, outputPath } = parseCliArgs();

  // If input cases file doesn't exist, create default Appendix B cases.json file
  if (!fs.existsSync(inputPath)) {
    console.log(`\nℹ️  No input file found at "${inputPath}". Generating sample Appendix B cases.json...`);
    fs.writeFileSync(inputPath, JSON.stringify(DEFAULT_SAMPLE_CASES, null, 2), 'utf-8');
    console.log(`✅ Appendix B sample cases written to: ${inputPath}\n`);
  }

  console.log(`\n🧪 Appendix B Batch Execution`);
  console.log(`   Input file : ${inputPath}`);
  console.log(`   Output file: ${outputPath}\n`);

  const fileRaw = fs.readFileSync(inputPath, 'utf-8').trim();
  if (!fileRaw) {
    console.error('❌ Error: Input file is empty.');
    process.exit(1);
  }

  let inputCases: AppendixBBatchInputCase[] = [];

  try {
    const parsed = JSON.parse(fileRaw);
    if (Array.isArray(parsed)) {
      inputCases = parsed;
    } else if (typeof parsed === 'object') {
      inputCases = [parsed];
    }
  } catch {
    // Fallback: try parsing line-by-line JSONL format if JSON array parse failed
    const lines = fileRaw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    for (const line of lines) {
      try {
        inputCases.push(JSON.parse(line));
      } catch {
        // ignorable
      }
    }
  }

  if (inputCases.length === 0) {
    console.error('❌ Error: Could not parse valid Appendix B test cases from input file.');
    process.exit(1);
  }

  console.log(`🚀 Processing ${inputCases.length} case(s)...\n`);

  const kitsResults: AppendixBKitResult[] = [];
  const summaryRows: any[] = [];
  let hasFailure = false;

  for (let idx = 0; idx < inputCases.length; idx++) {
    const c = inputCases[idx]!;
    const caseId = c.id || `case-${String(idx + 1).padStart(2, '0')}`;
    const companyUrl = c.company_url || c.companyUrl || '';
    const jd = c.jd || '';
    const days = typeof c.days === 'number' ? c.days : 5;

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`▶ Processing Case [${caseId}] (${companyUrl || 'No URL'}, ${days} days)`);
    console.log(`--------------------------------------------------------------------------------`);

    const startTime = Date.now();
    try {
      const { finalKit } = await runKitGraph({
        jd,
        companyUrl,
        days,
        kitId: caseId,
      });

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
      const uncoveredMusts = checkCoverage(finalKit.role.requirements, finalKit.questions);

      kitsResults.push({
        id: caseId,
        status: 'ok',
        kit: finalKit,
        error: null,
      });

      summaryRows.push({
        ID: caseId,
        Status: 'ok',
        Company: finalKit.source.company || companyUrl,
        Role: finalKit.role.title || 'Unknown',
        Reqs: finalKit.role.requirements.length,
        Questions: finalKit.questions.length,
        Flashcards: finalKit.flashcards.length,
        Days: finalKit.schedule.days.length,
        UncoveredMust: uncoveredMusts.length,
        Time: `${elapsedSec}s`,
      });

      console.log(`  ✅ Finished in ${elapsedSec}s — Status: ok\n`);
    } catch (err: any) {
      hasFailure = true;
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

      const errorCode = err.code || (err.message?.includes('unreachable') ? 'COMPANY_UNREACHABLE' : 'EXECUTION_ERROR');
      const errorMessage = err.message || String(err);

      kitsResults.push({
        id: caseId,
        status: 'failed',
        kit: null,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      });

      summaryRows.push({
        ID: caseId,
        Status: 'failed',
        Company: companyUrl,
        Role: 'Error',
        Reqs: 0,
        Questions: 0,
        Flashcards: 0,
        Days: 0,
        UncoveredMust: -1,
        Time: `${elapsedSec}s`,
        Error: errorMessage,
      });

      console.error(`  ❌ Failed in ${elapsedSec}s — Error: ${errorMessage}\n`);
    }
  }

  // Construct Appendix B output JSON object
  const outputPayload: AppendixBBatchOutput = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    kits: kitsResults,
  };

  // Write output file
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf-8');
  console.log(`================================================================================`);
  console.log(`💾 Appendix B output JSON successfully written to: ${outputPath}`);
  console.log(`================================================================================\n`);

  console.table(summaryRows);

  if (hasFailure) {
    console.error(`\n❌ Batch execution finished with errors. Output saved to ${outputPath}. Exiting code 1.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All cases executed successfully! Output saved to ${outputPath}. Exiting code 0.`);
    process.exit(0);
  }
}

runEvaluation();
