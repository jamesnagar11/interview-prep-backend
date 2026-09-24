import dotenv from 'dotenv';
dotenv.config();

import { db } from './prisma/db';
import { runKitGraph } from './graph/graph';

async function testFullPipeline() {
  console.log('🧪 Starting End-to-End Pipeline Test...');

  // 1. Create a dummy kit record in DB with PENDING status
  const sampleJd = `
Job Title: Senior Full Stack Engineer
Seniority: Senior
Location: Remote, USA

About the Role:
We are looking for a Senior Full Stack Engineer with 5+ years of experience in React, TypeScript, Node.js, and MongoDB.
You will be responsible for designing and scaling microservices, building high-throughput event-driven systems, and mentoring junior engineers.

Requirements:
- Must have 5+ years of experience in TypeScript and Node.js
- Must have experience with React and modern CSS
- Must have experience with MongoDB and distributed system design
- Must have experience with Docker and CI/CD pipelines
- Strong communication and leadership skills (nice to have)
`;

  const companyUrl = 'https://www.gevernova.com/';
  const days = 7;

  console.log('📝 Creating test Kit record in DB...');
  const kitRow = await db.orm.kit.create({
    userId: 'test_user_123',
    companyUrl,
    jdText: sampleJd,
    daysAvailable: days,
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);

  const kitId = (kitRow as any)._id.toString();
  console.log(`✅ Kit record created with ID: ${kitId}`);

  // 2. Invoke full graph pipeline
  console.log('🚀 Running kitGraph pipeline...');
  const startTime = Date.now();
  
  try {
    const { finalKit } = await runKitGraph({
      jd: sampleJd,
      companyUrl,
      days,
      kitId,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✨ Graph pipeline completed successfully in ${elapsed}s!`);
    console.log(`📊 Summary of generated kit:`);
    console.log(`   - Company: ${finalKit.source.company}`);
    console.log(`   - Role Title: ${finalKit.role.title} (${finalKit.role.seniority})`);
    console.log(`   - Requirements Extracted: ${finalKit.role.requirements.length}`);
    console.log(`   - Brief Summary: "${finalKit.company_brief.summary.slice(0, 80)}..."`);
    console.log(`   - Questions Generated: ${finalKit.questions.length}`);
    console.log(`   - Flashcards Created: ${finalKit.flashcards.length}`);
    console.log(`   - Schedule Days: ${finalKit.schedule.days.length}`);
    console.log(`   - Coverage Passes: ${finalKit.coverage.passes}`);
    console.log(`   - Uncovered Must-Have Reqs: ${finalKit.coverage.uncovered_requirement_ids.length}`);

    // 3. Verify Kit in DB
    const updatedKit = await db.orm.kit.where({ _id: kitId as any }).first();
    console.log(`\n💾 DB Status Check: status="${(updatedKit as any)?.status}"`);
    if ((updatedKit as any)?.status === 'READY') {
      console.log('🎉 SUCCESS: Kit status is READY and fully persisted in DB!');
    } else {
      console.error(`❌ ERROR: Expected status READY, got "${(updatedKit as any)?.status}"`);
    }

    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Pipeline Execution Failed!');
    console.error(err);
    process.exit(1);
  }
}

testFullPipeline();
