/**
 * Create a test user for engine-v2 (and other) endpoints
 *
 * Usage: npx tsx src/scripts/create-test-user.ts [name]
 *
 * Creates a user with the given name (or "Test User" if not provided)
 * and prints the userId for use in API calls.
 */

import "dotenv/config";
import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  const userName = process.argv[2] || "Test User";

  try {
    const user = await prisma.user.create({
      data: {
        name: userName,
      },
    });

    console.log("\n✅ Test user created successfully!");
    console.log(`   User ID: ${user.id}`);
    console.log(`   Name: ${user.name}`);
    console.log("\n📝 Use this userId in your API calls:");
    console.log(`   ?userId=${user.id}`);
    console.log("\n💡 Example curl command:");
    console.log(
      `   curl -X POST "http://localhost:3000/api/v1/engine-v2/analyze?userId=${user.id}" \\`
    );
    console.log(`     -F "gpxFile=@your-file.gpx"`);
    console.log();
  } catch (error) {
    console.error("❌ Error creating user:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
